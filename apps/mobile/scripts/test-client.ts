// Tests the mobile API client against a RUNNING server (the real thing, no mocks of the server).
//   API_URL=http://localhost:3056 TEST_EMAIL=... TEST_PASSWORD=... npx tsx scripts/test-client.ts
import assert from "node:assert/strict";
import { ApiError, createClient, type SecureStore } from "../src/lib/client";

const API_URL = process.env.API_URL ?? "http://localhost:3056";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set TEST_EMAIL and TEST_PASSWORD of a test account on the server.");
  process.exit(2);
}

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 5).join("\n      ")}`);
  }
}

function memoryStore(): SecureStore & { value: string | null } {
  const s = {
    value: null as string | null,
    get: async () => s.value,
    set: async (v: string) => void (s.value = v),
    clear: async () => void (s.value = null),
  };
  return s;
}

/** A fetch that counts calls per path and lets a test tamper with requests. */
function spyFetch(tamper?: (url: string, init: RequestInit) => RequestInit) {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = String(url).replace(API_URL, "");
    calls.push(`${init.method ?? "GET"} ${path}`);
    return fetch(url as string, tamper ? tamper(String(url), init) : init);
  }) as typeof fetch;
  return { fn, calls };
}

async function main() {
  await check("sign in, then /me shows the person, the company's branding and the plan", async () => {
    const store = memoryStore();
    const c = createClient({ baseUrl: API_URL, store });
    assert.equal(await c.hasSession(), false);
    await c.signIn(EMAIL!, PASSWORD!, { deviceName: "Test runner", platform: "android", appVersion: "0.1.0" });
    assert.equal(await c.hasSession(), true);
    assert.match(store.value!, /^r1_/);
    const me = await c.me();
    assert.equal(me.user.email, EMAIL);
    assert.ok(me.company.brand?.name);
    assert.ok(["trial", "active", "past_due_grace", "past_due", "canceling", "canceled", "trial_expired", "none"].includes(me.plan.state));
    assert.ok(me.plan.limits.projects >= 0 && me.plan.usage.projects >= 0);
    await c.signOut();
  });

  await check("wrong password: a plain error, no session saved", async () => {
    const store = memoryStore();
    const c = createClient({ baseUrl: API_URL, store });
    const e = await c.signIn(EMAIL!, "definitely-not-the-password").catch((x) => x as ApiError);
    assert.ok(e instanceof ApiError);
    assert.deepEqual([e.status, e.code], [401, "invalid_credentials"]);
    assert.equal(store.value, null);
  });

  await check("lists: projects, categories, invoices (paged) and a missing invoice is a clean 404", async () => {
    const c = createClient({ baseUrl: API_URL, store: memoryStore() });
    await c.signIn(EMAIL!, PASSWORD!);
    const { projects } = await c.projects();
    assert.ok(Array.isArray(projects));
    const { categories } = await c.categories();
    assert.ok(Array.isArray(categories));
    const page = await c.invoices({ pageSize: 5 });
    assert.equal(page.page, 1);
    assert.ok(page.items.length <= 5);
    const missing = await c.invoice("does-not-exist").catch((x) => x as ApiError);
    assert.ok(missing instanceof ApiError);
    assert.equal(missing.status, 404);
    await c.signOut();
  });

  await check("an expired access token is refreshed ONCE even when 6 calls are waiting, and the refresh token rotates", async () => {
    const store = memoryStore();
    const spy = spyFetch();
    let clock = Date.now();
    const c = createClient({ baseUrl: API_URL, store, fetch: spy.fn, now: () => clock });
    await c.signIn(EMAIL!, PASSWORD!);
    const first = store.value;
    clock += 16 * 60_000; // the 15-minute access token is now stale
    const results = await Promise.all(Array.from({ length: 6 }, () => c.me()));
    assert.ok(results.every((r) => r.user.email === EMAIL));
    assert.equal(spy.calls.filter((x) => x.includes("/auth/refresh")).length, 1, spy.calls.join(" | "));
    assert.notEqual(store.value, first, "the saved refresh token changed");
    await c.signOut();
  });

  await check("a rejected access token is recovered by one refresh and the call is retried", async () => {
    const store = memoryStore();
    let broken = true;
    const spy = spyFetch((url, init) => {
      if (broken && url.includes("/api/v1/projects")) {
        broken = false;
        return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: "Bearer v1.tampered.token" } };
      }
      return init;
    });
    const c = createClient({ baseUrl: API_URL, store, fetch: spy.fn });
    await c.signIn(EMAIL!, PASSWORD!);
    const r = await c.projects();
    assert.ok(Array.isArray(r.projects));
    assert.equal(spy.calls.filter((x) => x.includes("/auth/refresh")).length, 1);
    assert.equal(spy.calls.filter((x) => x.includes("/api/v1/projects")).length, 2);
    await c.signOut();
  });

  await check("when the server ended the session, the next call signs the app out and clears the stored token", async () => {
    const store = memoryStore();
    let signedOut = 0;
    let lastAuth = "";
    const spy = spyFetch((_url, init) => {
      lastAuth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? lastAuth);
      return init;
    });
    const c = createClient({ baseUrl: API_URL, store, fetch: spy.fn, onSignedOut: () => void signedOut++ });
    await c.signIn(EMAIL!, PASSWORD!);
    await c.me(); // makes the client send its access token, which we keep
    // the server ends this session (the same call "Sign out" makes), without the client knowing
    const out = await fetch(`${API_URL}/api/v1/auth/logout`, { method: "POST", headers: { Authorization: lastAuth } });
    assert.equal(out.status, 200);
    // the stored refresh token is still the current one, so the server answers "session ended"
    const e = await c.projects().catch((x) => x as ApiError);
    assert.ok(e instanceof ApiError, "the call fails");
    assert.equal(e.status, 401);
    assert.equal(signedOut, 1);
    assert.equal(store.value, null);
    assert.equal(await c.hasSession(), false);
  });

  await check("no connection: a plain 'check your internet' error, and the session is kept", async () => {
    const store = memoryStore();
    const c = createClient({ baseUrl: API_URL, store });
    await c.signIn(EMAIL!, PASSWORD!);
    const offline = createClient({ baseUrl: "http://127.0.0.1:9", store });
    const e = await offline.me().catch((x) => x as ApiError);
    assert.ok(e instanceof ApiError);
    assert.deepEqual([e.status, e.code], [0, "network"]);
    assert.ok(store.value, "still signed in");
    await c.signOut();
  });

  await check("sign out ends the server session: the old refresh token is dead", async () => {
    const store = memoryStore();
    const c = createClient({ baseUrl: API_URL, store });
    await c.signIn(EMAIL!, PASSWORD!);
    const rt = store.value!;
    await c.signOut();
    assert.equal(store.value, null);
    const r = await fetch(`${API_URL}/api/v1/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
    assert.equal(r.status, 401);
  });

  await check("upload sends the file, project and category with the sign-in; a missing project is refused by the server", async () => {
    const c = createClient({ baseUrl: API_URL, store: memoryStore() });
    await c.signIn(EMAIL!, PASSWORD!);
    const { categories } = await c.categories();
    const form = new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" });
    const e = await c.upload(form as unknown as { uri: string; name: string; type: string }, "", categories[0]?.id ?? "x").catch((x) => x as ApiError);
    assert.ok(e instanceof ApiError, "refused");
    assert.equal(e.status, 400);
    assert.match(e.message, /project/i);
    await c.signOut();
  });


  // The checks below need an account that can do site work, material requests and deliveries (an engineer or manager) on a project that
  // has a sent order. They are skipped for other accounts.
  // One sign-in is shared by these checks (sign-in itself is rate limited).
  let shared: Promise<{ c: ReturnType<typeof createClient>; me: Awaited<ReturnType<ReturnType<typeof createClient>["me"]>>; ok: boolean }> | null = null;
  const modules = () =>
    (shared ??= (async () => {
      const c = createClient({ baseUrl: API_URL, store: memoryStore() });
      await c.signIn(EMAIL!, PASSWORD!);
      const me = await c.me();
      return { c, me, ok: ["site:write", "request:write", "delivery:write"].every((p) => me.permissions.includes(p)) };
    })());
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(7)]);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  await check("/me lists what the role may do, so the app can hide screens that would not work", async () => {
    const { c, me } = await modules();
    assert.ok(Array.isArray(me.permissions) && me.permissions.length > 0);
    assert.ok(me.permissions.every((p) => typeof p === "string"));
  });

  await check("site work from the client: overview, a daily report saved and submitted, an issue raised and moved, a photo added and opened", async () => {
    const { c, ok } = await modules();
    if (!ok) return console.log("      (skipped: this account cannot do site work)");
    const overview = await c.siteOverview();
    assert.ok(overview.projects.length > 0);
    const projectId = overview.projects[0].id;

    const saved = await c.saveSiteReport({ projectId, reportDate: yesterday, workDone: "Client test: shuttering on level 3", labourCount: "9", weather: "Clear" });
    assert.equal(saved.report.status, "DRAFT");
    const again = await c.siteReport(projectId, yesterday);
    assert.equal(again.report?.workDone, "Client test: shuttering on level 3");
    const bad = await c.saveSiteReport({ projectId, reportDate: yesterday, workDone: "" }).catch((x) => x as ApiError);
    assert.ok(bad instanceof ApiError && bad.status === 400, "an empty report is refused with a plain message");
    await c.submitSiteReport(saved.report.id);
    const locked = await c.saveSiteReport({ projectId, reportDate: yesterday, workDone: "Changed after submitting" }).catch((x) => x as ApiError);
    assert.ok(locked instanceof ApiError && /locked|submitted/i.test(locked.message), "locked after submitting");

    const made = await c.raiseIssue({ projectId, title: "Client test issue", severity: "LOW" });
    const detail = await c.siteIssue(made.id);
    assert.ok(detail.issue.next.includes("IN_PROGRESS"));
    await c.setIssueStatus(made.id, "IN_PROGRESS");
    const closed = await c.setIssueStatus(made.id, "CLOSED").catch((x) => x as ApiError);
    assert.ok(closed instanceof ApiError && closed.status === 400, "an engineer cannot close an issue");

    const up = await c.uploadSitePhotos([new File([JPEG], "a.jpg", { type: "image/jpeg" })], { projectId, issueId: made.id, area: "Level 2" });
    assert.equal(up.added, 1);
    const listed = await c.sitePhotos({ issueId: made.id });
    assert.equal(listed.photos.length, 1);
    const src = await c.photoSource(listed.photos[0].id);
    const res = await fetch(src.uri, { headers: src.headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    const noAuth = await fetch(src.uri);
    assert.equal(noAuth.status, 401, "a photo cannot be opened without the sign-in");
    await c.deleteSitePhoto(listed.photos[0].id);
  });

  await check("material request from the client: raised, sent for approval, taken back and cancelled", async () => {
    const { c, ok } = await modules();
    if (!ok) return console.log("      (skipped: this account cannot raise requests)");
    const projectId = (await c.siteOverview()).projects[0].id;
    const made = await c.raiseRequest({ projectId, note: "client test", lines: [{ description: "Client test cement", unit: "bag", quantity: "5" }], submit: true });
    assert.equal(made.submitted, true);
    const one = await c.purchaseRequest(made.id);
    assert.equal(one.request.status, "SUBMITTED");
    assert.ok(one.request.actions.includes("withdraw"));
    const refused = await c.raiseRequest({ projectId, lines: [] }).catch((x) => x as ApiError);
    assert.ok(refused instanceof ApiError && refused.status === 400);
    await c.actOnRequest(made.id, "withdraw");
    await c.changeRequest(made.id, { note: "changed", lines: [{ description: "Client test cement", unit: "bag", quantity: "6" }] });
    assert.equal((await c.purchaseRequest(made.id)).request.lines[0].quantity, "6");
    await c.actOnRequest(made.id, "cancel");
    assert.equal((await c.purchaseRequest(made.id)).request.status, "CANCELLED");
    const listed = await c.requests({ status: "CANCELLED" });
    assert.ok(listed.requests.some((r) => r.id === made.id));
  });

  await check("deliveries from the client: the list and the order carry no prices; a delivery is recorded and removed", async () => {
    const { c, ok } = await modules();
    if (!ok) return console.log("      (skipped: this account cannot record deliveries)");
    const list = await c.deliveries(true);
    if (list.deliveries.length === 0) return console.log("      (skipped: no order has been sent on this account)");
    const d = (await c.delivery(list.deliveries[0].orderId)).delivery;
    assert.equal(/rate|price|amount|total/i.test(JSON.stringify(d)), false, "no prices on the phone's delivery screen");
    if (!d.canRecord) return console.log("      (skipped: the first order cannot take deliveries)");
    const made = await c.recordDelivery(d.orderId, { challanNo: "CLIENT-TEST", lines: [{ orderLineId: d.lines[0].id, quantity: "1" }] });
    assert.ok((await c.delivery(d.orderId)).delivery.receipts.some((r) => r.id === made.id));
    const none = await c.recordDelivery(d.orderId, { lines: [] }).catch((x) => x as ApiError);
    assert.ok(none instanceof ApiError && none.status === 400);
    await c.deleteDelivery(made.id);
    assert.ok(!(await c.delivery(d.orderId)).delivery.receipts.some((r) => r.id === made.id));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
