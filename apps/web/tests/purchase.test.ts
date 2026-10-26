// Database-backed tests of the Purchase module: material requests, approval, purchase orders. Run through `npm run test:isolation`.
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

async function main() {
  const f = await import("@/lib/flows/purchase");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { rawDb } = await import("@/lib/db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  for (const [id, name] of [["o_pur_a", "Purchase Co A"], ["o_pur_b", "Purchase Co B"]]) await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@pur.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("pu_admin", "o_pur_a", "ADMIN");
  const accountant = await person("pu_acct", "o_pur_a", "ACCOUNTANT");
  const buyer = await person("pu_buyer", "o_pur_a", "PURCHASE");
  const mgr = await person("pu_mgr", "o_pur_a", "MANAGER");
  const eng = await person("pu_eng", "o_pur_a", "ENGINEER");
  const eng2 = await person("pu_eng2", "o_pur_a", "ENGINEER");
  const viewer = await person("pu_view", "o_pur_a", "VIEWER");
  const staff = await person("pu_staff", "o_pur_a", "STAFF");
  const other = await person("pu_other", "o_pur_b", "ADMIN");
  for (const [id, org, name] of [["p_pa1", "o_pur_a", "Tower A"], ["p_pa2", "o_pur_a", "Tower B"], ["p_pb1", "o_pur_b", "Other Site"]]) await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, org, name]);
  for (const u of [buyer, mgr, eng, viewer, staff]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_pur_a',$2,'p_pa1')`, [`pa_p${u.id}`, u.id]);
  await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_peng2','o_pur_a','pu_eng2','p_pa2')`);
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_a','o_pur_a','Shree Cement Traders'),('v_b','o_pur_b','Other Co Supplier')`);

  const lines = [{ description: "Cement OPC 53", unit: "bag", quantity: "40" }, { description: "TMT bar 12mm", unit: "kg", quantity: "1500.5" }];
  let reqId = "";

  await check("an engineer raises a request on their project: numbered, draft, with its lines; others cannot", async () => {
    const r = await f.saveRequest(eng, { projectId: "p_pa1", data: { note: "for slab", lines } });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    reqId = r.id;
    assert.match(r.number, /^MR-\d{4}-0001$/);
    const got = await f.getRequest(eng, reqId);
    assert.equal(got?.status, "DRAFT");
    assert.deepEqual(got?.lines.map((l) => [l.description, l.unit, l.quantity]), [["Cement OPC 53", "BAG", "40"], ["TMT bar 12mm", "KG", "1500.5"]]);
    assert.equal((await f.saveRequest(eng2, { projectId: "p_pa1", data: { lines } })).ok, false, "not their project");
    assert.equal((await f.saveRequest(viewer, { projectId: "p_pa1", data: { lines } })).ok, false, "viewers cannot raise");
    assert.equal((await f.saveRequest(staff, { projectId: "p_pa1", data: { lines } })).ok, false);
    assert.equal((await f.saveRequest(other, { projectId: "p_pa1", data: { lines } })).ok, false, "another company");
    assert.equal((await f.saveRequest(eng, { projectId: "p_pa1", data: { lines: [] } })).ok, false);
    const second = await f.saveRequest(eng, { projectId: "p_pa1", data: { lines: [lines[0]] } });
    assert.ok(second.ok && /-0002$/.test(second.number), "numbers go up one at a time");
  });

  await check("a draft can be edited by its author only; edits replace the lines", async () => {
    assert.ok((await f.saveRequest(eng, { requestId: reqId, projectId: "p_pa1", data: { lines: [lines[0], { description: "Sand", unit: "cft", quantity: "200" }] } })).ok);
    assert.equal((await f.getRequest(eng, reqId))?.lines.length, 2);
    assert.equal((await f.getRequest(eng, reqId))?.lines[1].description, "Sand");
    assert.equal((await f.saveRequest(mgr, { requestId: reqId, projectId: "p_pa1", data: { lines } })).ok, false, "someone else's draft");
    assert.equal((await q(`SELECT 1 FROM "MaterialRequestLine" WHERE "requestId"=$1`, [reqId])).length, 2, "old lines are gone, not piled up");
  });

  await check("who sees a request: its project's people and the all-projects roles; the engineer on another project does not", async () => {
    for (const u of [eng, mgr, viewer, admin, accountant, buyer]) assert.ok(await f.getRequest(u, reqId), u.id);
    for (const u of [eng2, staff, other]) assert.equal(await f.getRequest(u, reqId), null, u.id);
    assert.equal((await f.listRequests(eng2)).length, 0);
    assert.equal((await f.listRequests(other)).length, 0);
  });

  await check("submit, withdraw, submit again; nobody else can submit it", async () => {
    assert.equal((await f.submitRequest(mgr, reqId)).ok, false);
    assert.ok((await f.submitRequest(eng, reqId)).ok);
    assert.equal((await f.submitRequest(eng, reqId)).ok, false, "already submitted");
    assert.equal((await f.saveRequest(eng, { requestId: reqId, projectId: "p_pa1", data: { lines } })).ok, false, "locked while waiting");
    assert.ok((await f.withdrawRequest(eng, reqId)).ok);
    assert.equal((await f.getRequest(eng, reqId))?.status, "DRAFT");
    assert.ok((await f.submitRequest(eng, reqId)).ok);
  });

  await check("only an approver decides; a rejection needs a reason; the engineer cannot approve", async () => {
    assert.equal((await f.decideRequest(eng, reqId, true, "")).ok, false);
    assert.equal((await f.decideRequest(buyer, reqId, true, "")).ok, false);
    assert.equal((await f.decideRequest(viewer, reqId, true, "")).ok, false);
    assert.equal((await f.decideRequest(mgr, reqId, false, "")).ok, false, "reason required");
    const both = await Promise.all([f.decideRequest(mgr, reqId, true, "ok"), f.decideRequest(admin, reqId, false, "too much")]);
    assert.equal(both.filter((r) => r.ok).length, 1, "two people deciding at once: one wins");
  });

  await check("a manager cannot approve their own request; an administrator can", async () => {
    const r = await f.saveRequest(mgr, { projectId: "p_pa1", data: { lines: [lines[0]] } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.ok((await f.submitRequest(mgr, r.id)).ok);
    assert.equal((await f.decideRequest(mgr, r.id, true, "")).ok, false, "own request");
    assert.ok((await f.decideRequest(admin, r.id, true, "")).ok);
    assert.equal((await f.getRequest(mgr, r.id))?.status, "APPROVED");
  });

  await check("a rejected request records who and why, and cannot be ordered", async () => {
    const r = await f.saveRequest(eng, { projectId: "p_pa1", data: { lines: [lines[0]] } });
    assert.ok(r.ok);
    if (!r.ok) return;
    await f.submitRequest(eng, r.id);
    assert.ok((await f.decideRequest(mgr, r.id, false, "Use the stock already on site")).ok);
    const got = await f.getRequest(eng, r.id);
    assert.deepEqual([got?.status, got?.decisionNote, got?.decidedByName], ["REJECTED", "Use the stock already on site", `MANAGER pu_mgr`]);
    const order = await f.createOrder(buyer, { projectId: "p_pa1", requestId: r.id, data: { vendorId: "v_a", lines: [{ ...lines[0], rate: "380", gstPercent: "18" }] } });
    assert.equal(order.ok, false);
  });

  let orderId = "";
  await check("the purchase officer orders from an approved request: numbered PO, totals right, request becomes Ordered", async () => {
    const approved = (await f.listRequests(admin, { status: ["APPROVED"] }))[0];
    assert.ok(approved);
    const bad = await f.createOrder(eng, { projectId: "p_pa1", requestId: approved.id, data: { vendorId: "v_a", lines: [{ ...lines[0], rate: "380", gstPercent: "18" }] } });
    assert.equal(bad.ok, false, "engineers do not order");
    assert.equal((await f.createOrder(buyer, { projectId: "p_pa1", requestId: approved.id, data: { vendorId: "v_b", lines: [{ ...lines[0], rate: "380" }] } })).ok, false, "supplier of another company");
    assert.equal((await f.createOrder(buyer, { projectId: "p_pa1", requestId: approved.id, data: { vendorId: "v_a", lines: [{ ...lines[0], rate: "" }] } })).ok, false, "rate needed");
    const r = await f.createOrder(buyer, { projectId: "p_pa1", requestId: approved.id, data: { vendorId: "v_a", paymentTerms: "30 days", lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "40", rate: "380.00", gstPercent: "18" }, { description: "Binding wire", unit: "kg", quantity: "10.5", rate: "95.50", gstPercent: "18" }] } });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    orderId = r.id;
    assert.match(r.number, /^PO-\d{4}-0001$/);
    const o = await f.getOrder(buyer, orderId);
    // 40 x 380.00 = 15200.00; 10.5 x 95.50 = 1002.75; GST 18% = 2736.00 + 180.495 -> 180.50
    assert.deepEqual([o?.subtotalMinor, o?.gstMinor, o?.totalMinor], [1_520_000 + 100_275, 273_600 + 18_050, 1_520_000 + 100_275 + 273_600 + 18_050]);
    assert.equal(o?.status, "DRAFT");
    assert.equal((await f.getRequest(buyer, approved.id))?.status, "ORDERED");
    assert.equal((await f.getRequest(buyer, approved.id))?.orders[0]?.number, r.number);
  });

  await check("order visibility: engineer sees no orders or rates; accountant, viewer and manager see them", async () => {
    assert.equal(await f.getOrder(eng, orderId), null, "an engineer does not see prices");
    assert.equal((await f.listOrders(eng)).length, 0);
    for (const u of [buyer, admin, accountant, viewer, mgr]) assert.ok(await f.getOrder(u, orderId), u.id);
    for (const u of [eng2, staff, other]) assert.equal(await f.getOrder(u, orderId), null, u.id);
    assert.equal((await f.getRequest(eng, (await f.getOrder(buyer, orderId))!.requestId!))?.orders.length, 0, "the request page does not leak order numbers to an engineer");
  });

  await check("a draft order can be changed, then sent; after that only cancelled", async () => {
    const o = (await f.getOrder(buyer, orderId))!;
    assert.equal((await f.updateOrder(accountant, orderId, { vendorId: "v_a", lines: [{ ...lines[0], rate: "1" }] })).ok, false);
    assert.ok((await f.updateOrder(buyer, orderId, { vendorId: "v_a", deliveryDate: o.orderDate, lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "50", rate: "375", gstPercent: "18" }] })).ok);
    const changed = (await f.getOrder(buyer, orderId))!;
    assert.deepEqual([changed.lines.length, changed.totalMinor], [1, Math.round(50 * 375 * 100 * 1.18)]);
    assert.equal((await q(`SELECT 1 FROM "PurchaseOrderLine" WHERE "orderId"=$1`, [orderId])).length, 1);
    assert.equal((await f.sendOrder(accountant, orderId)).ok, false);
    assert.ok((await f.sendOrder(buyer, orderId)).ok);
    assert.equal((await f.sendOrder(buyer, orderId)).ok, false, "already sent");
    assert.equal((await f.updateOrder(buyer, orderId, { vendorId: "v_a", lines: [{ ...lines[0], rate: "1" }] })).ok, false, "sent orders are not changed");
  });

  await check("cancelling needs a reason; the request becomes Approved again so it can be ordered again", async () => {
    assert.equal((await f.cancelOrder(buyer, orderId, "")).ok, false);
    assert.equal((await f.cancelOrder(viewer, orderId, "no")).ok, false);
    assert.ok((await f.cancelOrder(buyer, orderId, "Supplier has no stock")).ok);
    assert.equal((await f.cancelOrder(buyer, orderId, "again")).ok, false);
    const o = (await f.getOrder(buyer, orderId))!;
    assert.deepEqual([o.status, o.cancelReason], ["CANCELLED", "Supplier has no stock"]);
    assert.equal((await f.getRequest(buyer, o.requestId!))?.status, "APPROVED");
    const again = await f.createOrder(buyer, { projectId: "p_pa1", requestId: o.requestId, data: { vendorId: "v_a", lines: [{ ...lines[0], rate: "390" }] } });
    assert.ok(again.ok && /-0002$/.test(again.number), "PO numbers are never reused");
  });

  await check("a company's numbers are its own: another company starts again at 0001", async () => {
    await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_pother','o_pur_b','pu_other','p_pb1') ON CONFLICT DO NOTHING`);
    const r = await f.saveRequest(other, { projectId: "p_pb1", data: { lines: [lines[0]] } });
    assert.ok(r.ok && /-0001$/.test(r.number), JSON.stringify(r));
  });

  await check("two requests raised at once get two different numbers", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => f.saveRequest(admin, { projectId: "p_pa2", data: { lines: [lines[0]] } })));
    const numbers = results.map((r) => (r.ok ? r.number : "FAIL"));
    assert.ok(!numbers.includes("FAIL"), JSON.stringify(results));
    assert.equal(new Set(numbers).size, 6);
  });

  await check("company isolation holds in the database itself", async () => {
    assert.equal((await dbFor("o_pur_b").materialRequest.findMany({ where: { projectId: "p_pa1" } })).length, 0);
    assert.equal((await dbFor("o_pur_b").purchaseOrder.findMany()).length, 0);
    assert.equal((await dbFor("o_pur_b").documentCounter.findMany()).length, 1, "only its own counter");
    await assert.rejects(() => rawDb.purchaseOrder.create({ data: { organizationId: "o_pur_a", projectId: "p_pa1", vendorId: "v_a", number: "PO-X", orderDate: new Date() } }), /row-level security|violates/i);
  });

  const overview = await f.purchaseOverview(admin);
  await check("the overview counts what needs attention", () => {
    assert.ok(overview.approvedToOrder >= 1);
    assert.equal(typeof overview.sentValueMinor, "number");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
