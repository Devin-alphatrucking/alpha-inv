// Tests the offline queue and its sending rules with a pretend server that remembers references the way the real one does.
//   npx tsx scripts/test-offline.ts
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/client";
import { MAX_QUEUED, createQueue, discard, newRef, retry, saveAndSend, sendItem, syncAll, type Files, type LocalFile, type QueueItem, type Sender, type Storage } from "../src/lib/offline/queue";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 6).join("\n      ")}`);
  }
}

const offline = () => new ApiError(0, "network", "No connection.");
const refused = (m = "Title is required.") => new ApiError(400, "invalid", m);

function memoryStorage(): Storage & { text: string | null } {
  const s = { text: null as string | null, read: async () => s.text, write: async (t: string) => void (s.text = t) };
  return s;
}

function fakeFiles() {
  const kept = new Set<string>();
  const files: Files & { kept: Set<string> } = {
    kept,
    keep: async (f: LocalFile, ref: string, i: number) => {
      const uri = `kept://${ref}-${i}`;
      kept.add(uri);
      return { ...f, uri };
    },
    drop: async (f: LocalFile) => void kept.delete(f.uri),
  };
  return files;
}

/** Remembers what it was sent by reference, like the real server: a second send with a reference gives back the first record. */
function fakeServer() {
  const records = new Map<string, string>();
  const photoBatches = new Map<string, number>();
  const calls: string[] = [];
  const plan = { failNext: [] as unknown[], loseReplyOnce: false, photosFail: null as unknown };
  let n = 0;
  const gate = () => {
    const f = plan.failNext.shift();
    if (f) throw f;
  };
  const make = (kind: string) => async (...args: unknown[]) => {
    const body = (args.length === 2 ? args[1] : args[0]) as { clientRef: string; title?: string };
    calls.push(`${kind}:${body.clientRef}`);
    gate();
    if (body.title === "") throw refused();
    let id = records.get(body.clientRef);
    if (!id) {
      id = `srv${++n}`;
      records.set(body.clientRef, id);
    }
    if (plan.loseReplyOnce) {
      plan.loseReplyOnce = false;
      throw offline(); // saved, but the answer never arrived
    }
    return { ok: true as const, id };
  };
  const api: Sender = {
    raiseIssue: make("issue") as Sender["raiseIssue"],
    raiseRequest: make("request") as Sender["raiseRequest"],
    recordDelivery: make("delivery") as Sender["recordDelivery"],
    async uploadSitePhotos(files, target) {
      calls.push(`photos:${target.clientRef}:${files.length}`);
      gate();
      if (plan.photosFail) throw plan.photosFail;
      photoBatches.set(target.clientRef as string, files.length);
      return { ok: true as const, added: files.length, skipped: [] };
    },
  };
  return { api, records, photoBatches, calls, plan };
}

const me = { userId: "u1", companyId: "c1" };
const photo = (n: number): LocalFile => ({ uri: `file://picked/${n}.jpg`, name: `${n}.jpg`, type: "image/jpeg" });
const issue = (title = "Crack in beam", photos: LocalFile[] = []) => ({ kind: "issue" as const, ...me, label: title, body: { projectId: "p1", title }, projectId: "p1", photos });

async function main() {
  await check("a new reference is the kind the server accepts, and two are never the same", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const r = newRef();
      assert.match(r, /^[A-Za-z0-9_-]{8,64}$/);
      seen.add(r);
    }
    assert.equal(seen.size, 500);
  });

  await check("with a connection: sent at once, nothing left on the phone", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    const o = await saveAndSend(q, files, s.api, issue("Leak", [photo(1), photo(2)]));
    assert.equal(o.kind, "sent");
    assert.equal((await q.all()).length, 0);
    assert.equal(files.kept.size, 0, "the phone's copies of the photos are removed");
    assert.equal(s.records.size, 1);
    assert.equal(s.photoBatches.size, 1);
  });

  await check("no connection: kept with its photos, and sent later exactly once", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(offline());
    const o = await saveAndSend(q, files, s.api, issue("Leak", [photo(1)]));
    assert.equal(o.kind, "offline");
    const [item] = await q.all();
    assert.ok(item && item.state === "waiting" && !item.serverId);
    assert.equal(files.kept.size, 1, "the photo is still on the phone");
    const r = await syncAll(q, files, s.api, me);
    assert.deepEqual([r.sent, r.failed, r.offline], [1, 0, false]);
    assert.equal((await q.all()).length, 0);
    assert.equal(files.kept.size, 0);
    assert.equal(s.records.size, 1);
  });

  await check("a lost reply (saved, answer never arrived) does not make a second record when it goes again", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.loseReplyOnce = true;
    const o = await saveAndSend(q, files, s.api, issue("Once only"));
    assert.equal(o.kind, "offline");
    assert.equal(s.records.size, 1);
    assert.equal((await syncAll(q, files, s.api, me)).sent, 1);
    assert.equal(s.records.size, 1, "the server handed back the first record");
    assert.equal((await q.all()).length, 0);
  });

  await check("a refusal before anything was saved goes back to the form and leaves nothing behind", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    const o = await saveAndSend(q, files, s.api, issue("", [photo(1)]));
    assert.ok(o.kind === "rejected" && o.message === "Title is required.");
    assert.equal((await q.all()).length, 0);
    assert.equal(files.kept.size, 0);
  });

  await check("photos go in batches of ten with their own references, and a dropped connection resumes where it stopped", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    const photos = Array.from({ length: 23 }, (_, i) => photo(i));
    // record ok, batch 0 ok, batch 1 loses the signal
    s.plan.failNext.push(undefined, undefined, offline());
    const o = await saveAndSend(q, files, s.api, issue("Many photos", photos), { ref: "ref-many-photos" });
    assert.equal(o.kind, "offline");
    const [mid] = await q.all();
    assert.equal(mid.serverId, "srv1");
    assert.equal(mid.photoBatchesDone, 1);
    s.calls.length = 0;
    assert.equal((await syncAll(q, files, s.api, me)).sent, 1);
    assert.deepEqual(s.calls, ["photos:ref-many-photos-b1:10", "photos:ref-many-photos-b2:3"], "no second record, no repeat of batch 0");
    assert.equal(s.records.size, 1);
  });

  await check("a delivery photo goes to the receipt and a request carries no photos", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const targets: Record<string, string | undefined>[] = [];
    const s = fakeServer();
    const api: Sender = { ...s.api, uploadSitePhotos: async (f, t) => (targets.push(t), { ok: true as const, added: f.length, skipped: [] }) };
    await saveAndSend(q, files, api, { kind: "delivery", ...me, label: "PO-1", body: { lines: [] }, projectId: "p1", orderId: "o1", photos: [photo(1)] });
    await saveAndSend(q, files, api, { kind: "request", ...me, label: "Cement", body: { lines: [] }, projectId: "p1", photos: [] });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].receiptId, "srv1");
    assert.equal(targets[0].issueId, undefined);
  });

  await check("photos refused after the record was saved: the record is kept as 'needs a look' and a retry sends only the photos", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.photosFail = refused("That photo is too large.");
    const o = await saveAndSend(q, files, s.api, issue("Big photo", [photo(1)]), { ref: "ref-big-photo" });
    assert.ok(o.kind === "rejected");
    const [item] = await q.all();
    assert.ok(item.state === "failed" && item.serverId === "srv1" && item.error === "That photo is too large.");
    assert.equal(files.kept.size, 1, "nothing is thrown away without the person's say");
    assert.equal((await syncAll(q, files, s.api, me)).sent, 0, "a failed item is not retried on its own");
    s.plan.photosFail = null;
    s.calls.length = 0;
    await retry(q, "ref-big-photo");
    assert.equal((await syncAll(q, files, s.api, me)).sent, 1);
    assert.deepEqual(s.calls, ["photos:ref-big-photo-b0:1"]);
    assert.equal(s.records.size, 1);
  });

  await check("signed out: nothing is lost and nothing is called 'refused'", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(new ApiError(401, "session_ended", "Please sign in again."));
    const o = await saveAndSend(q, files, s.api, issue("Keep me"));
    assert.equal(o.kind, "signedOut");
    const [item] = await q.all();
    assert.equal(item.state, "waiting");
  });

  await check("a server that is down (5xx) or busy (429) is treated as 'try later', not as a refusal", async () => {
    for (const status of [500, 502, 503, 429, 408]) {
      const q = createQueue(memoryStorage());
      const s = fakeServer();
      s.plan.failNext.push(new ApiError(status, "x", "later"));
      const o = await saveAndSend(q, fakeFiles(), s.api, issue(`Status ${status}`));
      assert.equal(o.kind, "offline", String(status));
      assert.equal((await q.all())[0].state, "waiting");
    }
    for (const status of [400, 403, 404, 409]) {
      const q = createQueue(memoryStorage());
      const s = fakeServer();
      s.plan.failNext.push(new ApiError(status, "x", "no"));
      assert.equal((await saveAndSend(q, fakeFiles(), s.api, issue(`Status ${status}`))).kind, "rejected", String(status));
    }
  });

  await check("sync sends oldest first, stops at the first sign of no signal, and leaves the rest waiting", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    for (const [i, name] of ["first", "second", "third"].entries()) {
      s.plan.failNext.push(offline());
      await saveAndSend(q, files, s.api, issue(name), { ref: `ref-order-${i}-xx`, now: () => 1000 + i });
    }
    assert.equal((await q.all()).length, 3);
    s.calls.length = 0;
    s.plan.failNext.push(undefined, offline()); // first goes, second has no signal
    const r = await syncAll(q, files, s.api, me);
    assert.deepEqual([r.sent, r.offline, r.left], [1, true, 2]);
    assert.deepEqual(s.calls, ["issue:ref-order-0-xx", "issue:ref-order-1-xx"], "third was never tried");
    assert.deepEqual((await q.all()).map((i) => i.id), ["ref-order-1-xx", "ref-order-2-xx"]);
  });

  await check("one person's queue is not sent by another person or in another company", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(offline());
    await saveAndSend(q, files, s.api, issue("Mine"));
    assert.equal((await q.forPerson("u2", "c1")).length, 0);
    assert.equal((await q.forPerson("u1", "c2")).length, 0);
    const r = await syncAll(q, files, s.api, { userId: "u2", companyId: "c1" });
    assert.equal(r.sent, 0);
    assert.equal(s.records.size, 0);
    assert.equal((await q.forPerson("u1", "c1")).length, 1);
  });

  await check("the queue survives the app closing, and a damaged file does not stop the app", async () => {
    const storage = memoryStorage();
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(offline());
    await saveAndSend(createQueue(storage), files, s.api, issue("Survives"));
    const again = createQueue(storage);
    assert.equal((await again.all()).length, 1);
    assert.equal((await again.all())[0].label, "Survives");
    storage.text = "{not json";
    assert.deepEqual(await createQueue(storage).all(), []);
    storage.text = JSON.stringify({ not: "a list" });
    assert.deepEqual(await createQueue(storage).all(), []);
  });

  await check("many saves at the same moment are all kept", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(...Array.from({ length: 20 }, offline));
    await Promise.all(Array.from({ length: 20 }, (_, i) => saveAndSend(q, files, s.api, issue(`Item ${i}`))));
    assert.equal((await q.all()).length, 20);
    assert.equal(new Set((await q.all()).map((i) => i.id)).size, 20);
  });

  await check("throwing an item away removes it and its photo copies; an item discarded during a send is not brought back", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    s.plan.failNext.push(offline());
    await saveAndSend(q, files, s.api, issue("Gone", [photo(1)]), { ref: "ref-discard-me" });
    assert.equal(files.kept.size, 1);
    await discard(q, files, "ref-discard-me");
    assert.equal((await q.all()).length, 0);
    assert.equal(files.kept.size, 0);
    assert.equal(await q.update("ref-discard-me", { state: "failed" }), null);
    assert.equal((await q.all()).length, 0);
    await discard(q, files, "never-existed"); // harmless
  });

  await check("too many waiting items is refused with a clear message and leaves no photo copies behind", async () => {
    const q = createQueue(memoryStorage());
    const files = fakeFiles();
    const s = fakeServer();
    const base: QueueItem = { id: "x", kind: "issue", ...me, label: "x", createdAt: 1, body: {}, projectId: "p1", photos: [], photoBatchesDone: 0, state: "waiting", attempts: 0 };
    for (let i = 0; i < MAX_QUEUED; i++) await q.add({ ...base, id: `fill-${i}-padding` });
    await assert.rejects(() => saveAndSend(q, files, s.api, issue("One too many", [photo(1)])), /Too many items/);
    assert.equal(files.kept.size, 0);
  });

  await check("sendItem alone: an item whose record is already saved never sends the record again", async () => {
    const q = createQueue(memoryStorage());
    const s = fakeServer();
    const item: QueueItem = { id: "ref-already-saved", kind: "issue", ...me, label: "x", createdAt: 1, body: {}, projectId: "p1", photos: [], serverId: "srv-existing", photoBatchesDone: 0, state: "waiting", attempts: 1 };
    await q.add(item);
    const o = await sendItem(q, item, s.api);
    assert.ok(o.kind === "sent" && o.serverId === "srv-existing");
    assert.deepEqual(s.calls, []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
