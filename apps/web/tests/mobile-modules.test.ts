// Database-backed tests of the phone API for site work, material requests and deliveries (/api/v1/...).
// The route handlers are called directly with real phone sign-in tokens. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
if (!ownerUrl || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 8).join("\n      ")}`);
  }
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);

async function main() {
  const { loginMobile } = await import("@/lib/mobile/sessions");
  const { hashPassword } = await import("@/lib/security/password");
  const flowsPurchase = await import("@/lib/flows/purchase");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "phone-password-12345";
  const hash = await hashPassword(PW);
  for (const [id, name] of [["o_mm_a", "Phone Co A"], ["o_mm_b", "Phone Co B"]]) await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  // The plan record is needed for the "not locked" check on every phone call.
  const [plan] = await q<{ id: string }>(`SELECT id FROM "Plan" WHERE code='PROJECT'`);
  for (const org of ["o_mm_a", "o_mm_b"]) await q(`INSERT INTO "Subscription"(id,"organizationId","planId",quantity,status,provider,"updatedAt") VALUES ($1,$2,$3,5,'ACTIVE','manual',now())`, [`sub_${org}`, org, plan.id]);

  const people: Record<string, { id: string; token: string }> = {};
  let n = 0;
  const person = async (key: string, orgId: string, role: string) => {
    const id = `mm_${key}`;
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now())`, [id, `${role} ${key}`, `${key}@mm.test`, hash]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    const r = await loginMobile({ email: `${key}@mm.test`, password: PW }, { ip: `203.0.113.${++n}` });
    assert.ok(r.ok, `login ${key}: ${JSON.stringify(r)}`);
    if (r.ok) people[key] = { id, token: r.tokens.accessToken };
  };
  await person("admin", "o_mm_a", "ADMIN");
  await person("mgr", "o_mm_a", "MANAGER");
  await person("buyer", "o_mm_a", "PURCHASE");
  await person("eng", "o_mm_a", "ENGINEER");
  await person("eng2", "o_mm_a", "ENGINEER");
  await person("view", "o_mm_a", "VIEWER");
  await person("staff", "o_mm_a", "STAFF");
  await person("other", "o_mm_b", "ADMIN");
  for (const [id, org, name] of [["p_mm1", "o_mm_a", "Tower A"], ["p_mm2", "o_mm_a", "Tower B"], ["p_mmb", "o_mm_b", "Other"]]) await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, org, name]);
  for (const k of ["mgr", "buyer", "eng", "view", "staff"]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_mm_a',$2,'p_mm1')`, [`pa_mm_${k}`, `mm_${k}`]);
  await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_mm_eng2','o_mm_a','mm_eng2','p_mm2')`);
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_mm','o_mm_a','Phone Supplier')`);

  type Route = Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
  const call = async (key: string | null, handler: Route, method: string, path: string, opts: { body?: unknown; form?: FormData; ctx?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${people[key].token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const req = new Request(`http://app.test${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
    const res = await handler[method](req, opts.ctx ? { params: Promise.resolve(opts.ctx) } : undefined);
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, body: type.includes("json") ? ((await res.json()) as Record<string, any>) : null, res }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const r = async (p: string) => (await import(`@/app/api/v1/${p}/route`)) as unknown as Route;
  const today = new Date().toISOString().slice(0, 10);

  await check("/me tells the phone what the role may do; no sign-in is a plain 401", async () => {
    const me = await r("me");
    const eng = await call("eng", me, "GET", "/api/v1/me");
    assert.equal(eng.status, 200);
    assert.ok(eng.body!.permissions.includes("site:write") && eng.body!.permissions.includes("delivery:write") && eng.body!.permissions.includes("request:write"));
    assert.ok(!eng.body!.permissions.includes("order:view"), "engineers do not get prices");
    const staff = await call("staff", me, "GET", "/api/v1/me");
    assert.ok(!staff.body!.permissions.includes("site:view") && !staff.body!.permissions.includes("request:view"));
    assert.equal((await call(null, await r("site/overview"), "GET", "/api/v1/site/overview")).status, 401);
  });

  await check("site overview: only for roles with site work, only the person's projects", async () => {
    const h = await r("site/overview");
    const eng = await call("eng", h, "GET", "/api/v1/site/overview");
    assert.deepEqual(eng.body!.projects.map((p: { name: string }) => p.name), ["Tower A"]);
    assert.equal((await call("admin", h, "GET", "/api/v1/site/overview")).body!.projects.length, 2);
    assert.equal((await call("staff", h, "GET", "/api/v1/site/overview")).status, 403);
  });

  let reportId = "";
  await check("daily report: save a draft, read it back, submit it; viewers and other projects are refused", async () => {
    const h = await r("site/reports");
    const body = { projectId: "p_mm1", reportDate: today, weather: "Clear", workDone: "Poured the slab", labourCount: 12 };
    const saved = await call("eng", h, "PUT", "/api/v1/site/reports", { body });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    reportId = saved.body!.report.id;
    assert.equal(saved.body!.report.status, "DRAFT");
    const got = await call("eng", h, "GET", `/api/v1/site/reports?projectId=p_mm1&date=${today}`);
    assert.equal(got.body!.report.workDone, "Poured the slab");
    assert.equal((await call("view", h, "PUT", "/api/v1/site/reports", { body })).status, 403);
    assert.equal((await call("eng2", h, "PUT", "/api/v1/site/reports", { body })).status, 400, "not on that project");
    assert.equal((await call("eng", h, "PUT", "/api/v1/site/reports", { body: { ...body, workDone: "" } })).status, 400);
    assert.equal((await call("eng", h, "GET", "/api/v1/site/reports?projectId=p_mm1&date=nope")).status, 400);
    assert.equal((await call("eng2", h, "GET", `/api/v1/site/reports?projectId=p_mm1&date=${today}`)).body!.report, null, "another project's report is invisible");
    const act = await r("site/reports/[id]");
    assert.equal((await call("eng", act, "POST", `/api/v1/site/reports/${reportId}`, { body: { action: "submit" }, ctx: { id: reportId } })).status, 200);
    assert.equal((await call("eng", h, "PUT", "/api/v1/site/reports", { body: { ...body, workDone: "Changed" } })).status, 400, "locked after submitting");
    assert.equal((await call("eng", act, "POST", `/api/v1/site/reports/${reportId}`, { body: { action: "reopen" }, ctx: { id: reportId } })).status, 400, "engineers cannot reopen");
    assert.equal((await call("mgr", act, "POST", `/api/v1/site/reports/${reportId}`, { body: { action: "reopen" }, ctx: { id: reportId } })).status, 200);
  });

  let photoId = "";
  await check("photos: add to the report with the phone's sign-in, list, open the picture, delete; others cannot see it", async () => {
    const add = await r("site/photos");
    const form = new FormData();
    form.set("projectId", "p_mm1");
    form.set("reportId", reportId);
    form.set("area", "Level 2");
    form.append("file", new File([new Uint8Array(JPEG)], "a.jpg", { type: "image/jpeg" }));
    form.append("file", new File([new TextEncoder().encode("<html>")], "evil.jpg", { type: "image/jpeg" }));
    const up = await call("eng", add, "POST", "/api/v1/site/photos", { form });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body!.added, 1);
    assert.equal(up.body!.skipped.length, 1);
    const list = await call("eng", add, "GET", `/api/v1/site/photos?reportId=${reportId}`);
    assert.equal(list.body!.photos.length, 1);
    photoId = list.body!.photos[0].id;
    const one = await r("site/photos/[id]");
    const file = await call("eng", one, "GET", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } });
    assert.equal(file.status, 200);
    assert.equal(file.res.headers.get("content-type"), "image/jpeg");
    assert.equal(file.res.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await call("eng2", one, "GET", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } })).status, 404);
    assert.equal((await call("other", one, "GET", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } })).status, 404);
    assert.equal((await call(null, one, "GET", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } })).status, 401);
    assert.equal((await call("view", add, "POST", "/api/v1/site/photos", { form })).status, 403, "viewers cannot add photos");
    assert.equal((await call("view", one, "DELETE", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } })).status, 400);
    assert.equal((await call("eng", one, "DELETE", `/api/v1/site/photos/${photoId}`, { ctx: { id: photoId } })).status, 200);
  });

  let issueId = "";
  await check("issues: raise one, list them, move it along; only a manager closes", async () => {
    const h = await r("site/issues");
    const made = await call("eng", h, "POST", "/api/v1/site/issues", { body: { projectId: "p_mm1", title: "Crack in beam B3", severity: "HIGH", dueDate: "2020-01-01" } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    issueId = made.body!.id;
    const list = await call("eng", h, "GET", "/api/v1/site/issues");
    assert.equal(list.body!.issues.length, 1);
    assert.equal(list.body!.counts.overdue, 1);
    assert.equal((await call("eng2", h, "GET", "/api/v1/site/issues")).body!.issues.length, 0);
    assert.equal((await call("view", h, "POST", "/api/v1/site/issues", { body: { projectId: "p_mm1", title: "Viewer issue", severity: "LOW" } })).status, 403);
    assert.equal((await call("eng", h, "POST", "/api/v1/site/issues", { body: { projectId: "p_mm1", title: "x", severity: "LOW" } })).status, 400);
    const one = await r("site/issues/[id]");
    const detail = await call("eng", one, "GET", `/api/v1/site/issues/${issueId}`, { ctx: { id: issueId } });
    assert.deepEqual(detail.body!.issue.next, ["IN_PROGRESS", "FIXED"]);
    assert.equal((await call("eng", one, "POST", `/api/v1/site/issues/${issueId}`, { body: { status: "FIXED" }, ctx: { id: issueId } })).status, 200);
    assert.equal((await call("eng", one, "POST", `/api/v1/site/issues/${issueId}`, { body: { status: "CLOSED" }, ctx: { id: issueId } })).status, 400);
    assert.equal((await call("mgr", one, "POST", `/api/v1/site/issues/${issueId}`, { body: { status: "CLOSED" }, ctx: { id: issueId } })).status, 200);
    assert.equal((await call("eng2", one, "GET", `/api/v1/site/issues/${issueId}`, { ctx: { id: issueId } })).status, 404);
    assert.equal((await call("other", one, "GET", `/api/v1/site/issues/${issueId}`, { ctx: { id: issueId } })).status, 404);
    const people = await call("eng", await r("site/people"), "GET", "/api/v1/site/people?projectId=p_mm1");
    assert.ok(people.body!.people.some((p: { id: string }) => p.id === "mm_mgr"));
  });

  let requestId = "";
  await check("material request: raise and send for approval from the phone; others on the project see it, other projects do not", async () => {
    const h = await r("purchase/requests");
    const made = await call("eng", h, "POST", "/api/v1/purchase/requests", { body: { projectId: "p_mm1", note: "slab", lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "40" }], submit: true } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    requestId = made.body!.id;
    assert.equal(made.body!.submitted, true);
    assert.equal((await call("eng", h, "POST", "/api/v1/purchase/requests", { body: { projectId: "p_mm1", lines: [] } })).status, 400);
    assert.equal((await call("view", h, "POST", "/api/v1/purchase/requests", { body: { projectId: "p_mm1", lines: [{ description: "x y", unit: "kg", quantity: "1" }] } })).status, 403);
    assert.equal((await call("staff", h, "GET", "/api/v1/purchase/requests")).status, 403);
    const list = await call("mgr", h, "GET", "/api/v1/purchase/requests?status=SUBMITTED");
    assert.equal(list.body!.requests.length, 1);
    assert.equal(list.body!.waitingForApproval, 1);
    assert.equal((await call("eng2", h, "GET", "/api/v1/purchase/requests")).body!.requests.length, 0);
    const one = await r("purchase/requests/[id]");
    assert.equal((await call("other", one, "GET", `/api/v1/purchase/requests/${requestId}`, { ctx: { id: requestId } })).status, 404);
    assert.ok((await call("mgr", one, "GET", `/api/v1/purchase/requests/${requestId}`, { ctx: { id: requestId } })).body!.request.actions.includes("approve"));
  });

  await check("approval from the phone: an engineer cannot approve; a rejection needs a reason; a manager approves", async () => {
    const one = await r("purchase/requests/[id]");
    const ctx = { id: requestId };
    const path = `/api/v1/purchase/requests/${requestId}`;
    assert.equal((await call("eng", one, "POST", path, { body: { action: "approve" }, ctx })).status, 400);
    assert.equal((await call("mgr", one, "POST", path, { body: { action: "reject" }, ctx })).status, 400);
    assert.equal((await call("mgr", one, "POST", path, { body: { action: "approve", note: "ok" }, ctx })).status, 200);
    assert.equal((await call("eng", one, "GET", path, { ctx })).body!.request.status, "APPROVED");
    assert.equal((await call("mgr", one, "POST", path, { body: { action: "nonsense" }, ctx })).status, 400);
  });

  let orderId = "";
  await check("deliveries: after the office sends the order, the engineer sees items without prices and records what arrived", async () => {
    const buyer = { id: "mm_buyer", role: "PURCHASE" as never, orgId: "o_mm_a" };
    const order = await flowsPurchase.createOrder(buyer, { projectId: "p_mm1", requestId, data: { vendorId: "v_mm", lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "40", rate: "380", gstPercent: "18" }] } });
    assert.ok(order.ok);
    if (!order.ok) return;
    orderId = order.id;
    assert.ok((await flowsPurchase.sendOrder(buyer, orderId)).ok);
    const list = await call("eng", await r("deliveries"), "GET", "/api/v1/deliveries");
    assert.equal(list.body!.deliveries.length, 1);
    assert.equal(JSON.stringify(list.body).includes("380"), false);
    const one = await r("deliveries/[orderId]");
    const detail = await call("eng", one, "GET", `/api/v1/deliveries/${orderId}`, { ctx: { orderId } });
    assert.equal(detail.status, 200);
    assert.equal(JSON.stringify(detail.body).includes("380"), false, "no prices on the phone's delivery screen");
    const line = detail.body!.delivery.lines[0].id;
    const rec = await call("eng", one, "POST", `/api/v1/deliveries/${orderId}`, { body: { challanNo: "C-1", lines: [{ orderLineId: line, quantity: "30", rejected: "2" }] }, ctx: { orderId } });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    const after = await call("eng", one, "GET", `/api/v1/deliveries/${orderId}`, { ctx: { orderId } });
    assert.equal(after.body!.delivery.progress, "PARTLY");
    assert.equal((await call("view", one, "POST", `/api/v1/deliveries/${orderId}`, { body: { lines: [{ orderLineId: line, quantity: "1" }] }, ctx: { orderId } })).status, 403);
    assert.equal((await call("eng", one, "POST", `/api/v1/deliveries/${orderId}`, { body: { lines: [] }, ctx: { orderId } })).status, 400);
    assert.equal((await call("eng2", one, "GET", `/api/v1/deliveries/${orderId}`, { ctx: { orderId } })).status, 404);
    assert.equal((await call("staff", await r("deliveries"), "GET", "/api/v1/deliveries")).status, 403);
    // photo of the challan, then remove the delivery
    const receiptId = after.body!.delivery.receipts[0].id;
    const form = new FormData();
    form.set("projectId", "p_mm1");
    form.set("receiptId", receiptId);
    form.append("file", new File([new Uint8Array(JPEG)], "challan.jpg", { type: "image/jpeg" }));
    assert.equal((await call("eng", await r("site/photos"), "POST", "/api/v1/site/photos", { form })).status, 200);
    assert.equal((await call("eng", await r("site/photos"), "GET", `/api/v1/site/photos?receiptId=${receiptId}`)).body!.photos.length, 1);
    const del = await r("deliveries/receipts/[id]");
    assert.equal((await call("view", del, "DELETE", `/api/v1/deliveries/receipts/${receiptId}`, { ctx: { id: receiptId } })).status, 403);
    assert.equal((await call("eng", del, "DELETE", `/api/v1/deliveries/receipts/${receiptId}`, { ctx: { id: receiptId } })).status, 200);
  });

  await check("drawings on the phone: list, detail with history, a short-lived link to open the file; role and company checks", async () => {
    const docs = await import("@/lib/flows/documents");
    const mgrUser = { id: "mm_mgr", role: "MANAGER" as never, orgId: "o_mm_a" };
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 1)]);
    const made = await docs.createDocument(mgrUser, { projectId: "p_mm1", data: { title: "Foundation plan", number: "S-101", category: "STRUCTURAL", revision: "A" }, file: { name: "s101.pdf", bytes: pdf } });
    assert.ok(made.ok);
    if (!made.ok) return;
    assert.ok((await docs.addRevision(mgrUser, made.id, { data: { revision: "B", note: "Beam changed" }, file: { name: "s101b.pdf", bytes: pdf } })).ok);
    const list = await call("eng", await r("site/documents"), "GET", "/api/v1/site/documents?projectId=p_mm1");
    assert.equal(list.status, 200);
    assert.equal(list.body!.documents.length, 1);
    assert.equal(list.body!.documents[0].current.revision, "B");
    assert.equal((await call("eng2", await r("site/documents"), "GET", "/api/v1/site/documents")).body!.documents.length, 0);
    assert.equal((await call("staff", await r("site/documents"), "GET", "/api/v1/site/documents")).status, 403);
    const one = await r("site/documents/[id]");
    const detail = await call("eng", one, "GET", `/api/v1/site/documents/${made.id}`, { ctx: { id: made.id } });
    assert.deepEqual(detail.body!.document.revisions.map((x: { revision: string }) => x.revision), ["B", "A"]);
    assert.equal((await call("eng2", one, "GET", `/api/v1/site/documents/${made.id}`, { ctx: { id: made.id } })).status, 404);
    assert.equal((await call("other", one, "GET", `/api/v1/site/documents/${made.id}`, { ctx: { id: made.id } })).status, 404);
    const rid = detail.body!.document.current.id;
    const link = await r("site/documents/revisions/[rid]/link");
    const got = await call("eng", link, "POST", `/api/v1/site/documents/revisions/${rid}/link`, { body: {}, ctx: { rid } });
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.match(got.body!.url, /\/api\/site\/documents\/dl\?token=/);
    assert.equal(got.body!.expiresInSeconds, 300);
    assert.equal((await call("eng2", link, "POST", `/api/v1/site/documents/revisions/${rid}/link`, { body: {}, ctx: { rid } })).status, 404, "no link for a drawing the person cannot see");
    assert.equal((await call(null, link, "POST", `/api/v1/site/documents/revisions/${rid}/link`, { body: {}, ctx: { rid } })).status, 401);
    // the link opens the file without any sign-in header
    const dl = await import("@/app/api/site/documents/dl/route");
    const opened = await dl.GET(new Request(got.body!.url));
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get("content-type"), "application/pdf");
    assert.equal((await dl.GET(new Request("http://app.test/api/site/documents/dl?token=broken"))).status, 410);
  });

  await check("a company's phone user never reaches another company's records", async () => {
    for (const [mod, path, ctx] of [
      ["site/issues/[id]", `/api/v1/site/issues/${issueId}`, { id: issueId }],
      ["purchase/requests/[id]", `/api/v1/purchase/requests/${requestId}`, { id: requestId }],
      ["deliveries/[orderId]", `/api/v1/deliveries/${orderId}`, { orderId }],
    ] as const) assert.equal((await call("other", await r(mod), "GET", path, { ctx })).status, 404, mod);
    assert.equal((await call("other", await r("site/issues"), "GET", "/api/v1/site/issues")).body!.issues.length, 0);
    assert.equal((await call("other", await r("purchase/requests"), "GET", "/api/v1/purchase/requests")).body!.requests.length, 0);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
