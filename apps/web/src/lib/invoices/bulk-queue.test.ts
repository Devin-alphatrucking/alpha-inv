// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { addFiles, BULK_MAX_FILES, checkFile, formatBytes, inferType, isStopCode, runQueue, summarise, type FileLike, type Outcome, type QueueItem } from "./bulk-queue";

const f = (name: string, size = 1000, type = "application/pdf", lastModified = 1): FileLike => ({ name, size, type, lastModified });
let id = 0;
const nextId = () => `q${++id}`;

// ---- file checks
assert.equal(checkFile(f("a.pdf")), null);
assert.equal(checkFile(f("a.PNG", 10, "")), null, "the extension counts when the browser gives no type");
assert.equal(checkFile(f("a.jpeg", 10, "image/jpeg")), null);
assert.match(checkFile(f("a.docx", 10, "application/msword"))!, /PDF, JPG or PNG/);
assert.match(checkFile(f("a.pdf", 0))!, /empty/);
assert.match(checkFile(f("a.pdf", 20 * 1024 * 1024 + 1))!, /20 MB/);
assert.equal(checkFile(f("a.pdf", 20 * 1024 * 1024)), null, "exactly 20 MB is fine");
assert.match(checkFile(f("noextension", 10, ""))!, /PDF, JPG or PNG/);

// ---- type to send
assert.equal(inferType(f("a.pdf", 1, "application/pdf")), "application/pdf");
assert.equal(inferType(f("scan.PDF", 1, "")), "application/pdf");
assert.equal(inferType(f("photo.jpg", 1, "application/octet-stream")), "image/jpeg");
assert.equal(inferType(f("photo.jpeg", 1, "")), "image/jpeg");
assert.equal(inferType(f("shot.png", 1, "")), "image/png");
assert.equal(inferType(f("x.docx", 1, "")), "", "unknown stays unknown and is refused");

// ---- adding files
const first = addFiles([], [f("a.pdf"), f("b.pdf"), f("c.txt", 5, "text/plain"), f("a.pdf")], nextId);
assert.deepEqual(first.items.map((i) => i.file.name), ["a.pdf", "b.pdf"]);
assert.deepEqual(first.rejected.map((r) => r.name), ["c.txt", "a.pdf"]);
assert.match(first.rejected[1].reason, /Already/);
const more = addFiles(first.items, [f("a.pdf"), f("a.pdf", 1000, "application/pdf", 2), f("d.pdf")], nextId);
assert.deepEqual(more.items.map((i) => i.file.name), ["a.pdf", "b.pdf", "a.pdf", "d.pdf"], "same name but a different file is allowed");
assert.equal(more.rejected.length, 1);
assert.ok(more.items.every((i) => i.state === "waiting"));
const many = addFiles([], Array.from({ length: BULK_MAX_FILES + 3 }, (_, k) => f(`f${k}.pdf`)), nextId);
assert.equal(many.items.length, BULK_MAX_FILES);
assert.equal(many.rejected.length, 3);
assert.match(many.rejected[0].reason, /25 files/);
assert.equal(first.items.length, 2, "the list passed in is not changed");

// ---- stop codes
assert.ok(isStopCode("QUOTA_001") && isStopCode("PLAN_LOCKED") && isStopCode("PLAN_001"));
assert.ok(!isStopCode("VALIDATION_001") && !isStopCode(undefined) && !isStopCode(""));

// ---- running a queue
type Item = QueueItem<FileLike>;
const make = (names: string[]): Item[] => names.map((n) => ({ id: `r_${n}`, file: f(n), state: "waiting" as const }));
function harness(items: Item[]) {
  const live = new Map(items.map((i) => [i.id, { ...i }]));
  const log: string[] = [];
  return {
    live,
    log,
    onChange: (itemId: string, patch: Partial<Item>) => {
      Object.assign(live.get(itemId)!, patch);
      log.push(`${itemId}:${patch.state}`);
    },
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // everything succeeds, two at a time
  {
    const items = make(["a", "b", "c", "d", "e"]);
    const h = harness(items);
    let running = 0;
    let peak = 0;
    await runQueue(items, async (i) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(5);
      running--;
      return { ok: true, invoiceId: `inv_${i.id}` };
    }, { onChange: h.onChange });
    assert.equal(peak, 2, "two at a time");
    assert.ok([...h.live.values()].every((i) => i.state === "done" && i.invoiceId === `inv_${i.id}`));
    assert.equal(summarise([...h.live.values()]).finished, true);
  }

  // one failure does not stop the others
  {
    const items = make(["a", "b", "c"]);
    const h = harness(items);
    await runQueue(items, async (i): Promise<Outcome> => (i.id === "r_b" ? { ok: false, message: "Duplicate invoice", code: "VALIDATION_001" } : { ok: true, invoiceId: "x" }), { onChange: h.onChange });
    assert.deepEqual([...h.live.values()].map((i) => i.state), ["done", "failed", "done"]);
    assert.equal(h.live.get("r_b")!.message, "Duplicate invoice");
  }

  // a thrown error is a failed item, not a crashed queue
  {
    const items = make(["a", "b"]);
    const h = harness(items);
    await runQueue(items, async (i) => {
      if (i.id === "r_a") throw new Error("network down");
      return { ok: true, invoiceId: "x" };
    }, { onChange: h.onChange });
    assert.equal(h.live.get("r_a")!.state, "failed");
    assert.equal(h.live.get("r_a")!.message, "network down");
    assert.equal(h.live.get("r_b")!.state, "done");
  }

  // the page limit stops everything that has not started
  {
    const items = make(["a", "b", "c", "d", "e"]);
    const h = harness(items);
    const started: string[] = [];
    await runQueue(items, async (i) => {
      started.push(i.id);
      await sleep(2);
      return i.id === "r_b" ? { ok: false, message: "Monthly AI page limit reached.", code: "QUOTA_001" } : { ok: true, invoiceId: "x" };
    }, { concurrency: 1, onChange: h.onChange });
    assert.deepEqual(started, ["r_a", "r_b"], "nothing is tried after the limit");
    assert.deepEqual([...h.live.values()].map((i) => i.state), ["done", "failed", "skipped", "skipped", "skipped"]);
    assert.match(h.live.get("r_c")!.message!, /Not tried: Monthly AI page limit/);
  }

  // cancel: running files finish, the rest are skipped
  {
    const items = make(["a", "b", "c", "d"]);
    const h = harness(items);
    let cancelled = false;
    await runQueue(items, async (i) => {
      if (i.id === "r_a") cancelled = true;
      await sleep(3);
      return { ok: true, invoiceId: "x" };
    }, { concurrency: 1, isCancelled: () => cancelled, onChange: h.onChange });
    assert.deepEqual([...h.live.values()].map((i) => i.state), ["done", "skipped", "skipped", "skipped"]);
  }

  // only waiting items run (a retry of one failed file leaves the finished ones alone)
  {
    const items = make(["a", "b"]);
    items[0].state = "done";
    items[0].invoiceId = "old";
    const h = harness(items);
    let calls = 0;
    await runQueue(items, async () => (calls++, { ok: true, invoiceId: "new" }), { onChange: h.onChange });
    assert.equal(calls, 1);
    assert.equal(h.live.get("r_a")!.invoiceId, "old");
  }

  // an empty queue finishes at once
  await runQueue([], async () => ({ ok: true, invoiceId: "x" }), { onChange: () => assert.fail("nothing to change") });

  // ---- summary
  const s = summarise([
    { id: "1", file: f("a"), state: "done" }, { id: "2", file: f("b"), state: "failed" }, { id: "3", file: f("c"), state: "reading" },
    { id: "4", file: f("d"), state: "waiting" }, { id: "5", file: f("e"), state: "skipped" },
  ]);
  assert.deepEqual([s.total, s.done, s.failed, s.reading, s.waiting, s.skipped, s.settled, s.finished], [5, 1, 1, 1, 1, 1, 3, false]);
  assert.equal(summarise([]).finished, false);

  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(340 * 1024), "340 KB");
  assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");

  console.log("bulk queue: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
