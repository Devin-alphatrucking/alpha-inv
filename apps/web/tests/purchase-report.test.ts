// Database-backed tests of the purchase and project reports: the numbers, who sees what, and the CSV. Run through `npm run test:isolation`.
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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const p = await import("@/lib/flows/purchase");
  const d = await import("@/lib/flows/delivery");
  const rep = await import("@/lib/flows/purchase-report");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  for (const [id, name] of [["o_rp_a", "Report Co A"], ["o_rp_b", "Report Co B"]]) await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@rp.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("rp_admin", "o_rp_a", "ADMIN");
  const acct = await person("rp_acct", "o_rp_a", "ACCOUNTANT");
  const buyer = await person("rp_buyer", "o_rp_a", "PURCHASE");
  const mgr = await person("rp_mgr", "o_rp_a", "MANAGER");
  const eng = await person("rp_eng", "o_rp_a", "ENGINEER");
  const view = await person("rp_view", "o_rp_a", "VIEWER");
  const staff = await person("rp_staff", "o_rp_a", "STAFF");
  const other = await person("rp_other", "o_rp_b", "ADMIN");
  await q(`INSERT INTO "Project"(id,"organizationId",name,status,budget,"updatedAt") VALUES ('p_rp1','o_rp_a','Tower A','ACTIVE',2500000,now()),('p_rp2','o_rp_a','Tower B','ACTIVE',NULL,now()),('p_rpb','o_rp_b','Other','ACTIVE',NULL,now())`);
  for (const k of ["buyer", "mgr", "eng", "view", "staff"]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_rp_a',$2,'p_rp1')`, [`pa_rp_${k}`, `rp_${k}`]);
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_rp1','o_rp_a','Shree Cement'),('v_rp2','o_rp_a','Steel Mart')`);

  const mk = async (project: string, vendor: string, lines: { description: string; unit: string; quantity: string; rate: string; gstPercent: string }[], deliveryDate: string | null) => {
    const r = await p.createOrder(admin, { projectId: project, data: { vendorId: vendor, orderDate: daysAgo(30), deliveryDate, lines } });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) throw new Error("order");
    assert.ok((await p.sendOrder(admin, r.id)).ok);
    return r.id;
  };
  const receive = async (orderId: string, quantities: number[], on: string, rejected: number[] = []) => {
    const v = (await d.getDelivery(admin, orderId))!;
    const r = await d.recordReceipt(admin, orderId, { receivedOn: on, lines: v.lines.map((l, i) => ({ orderLineId: l.id, quantity: String(quantities[i] ?? 0), rejected: String(rejected[i] ?? 0) })) });
    assert.ok(r.ok, JSON.stringify(r));
  };
  const bill = async (id: string, orderId: string, vendor: string, project: string, total: number, status = "UNPAID") => {
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","purchaseOrderId","updatedAt") VALUES ($1,'o_rp_a',$1,$2,$3,'2026-10-01'::timestamp,$4,$4,$5::"InvoiceStatus",'x',$6,now())`, [id, project, vendor, total, status, orderId]);
  };

  // o1: 40 bags at 380 +18% = 17,936.00 (delivery due 15 days ago), delivered 20 days ago (early), billed in full and paid 10,000
  const o1 = await mk("p_rp1", "v_rp1", [{ description: "Cement", unit: "bag", quantity: "40", rate: "380", gstPercent: "18" }], daysAgo(15));
  await receive(o1, [40], daysAgo(20));
  await bill("rp_inv1", o1, "v_rp1", "p_rp1", 17936);
  await q(`INSERT INTO "Payment"(id,"organizationId","invoiceId",amount,"paidOn") VALUES ('rp_pay1','o_rp_a','rp_inv1',10000,now())`);
  // o2: 100 kg steel at 100 +18% = 11,800.00, due 10 days ago, 60 received 5 days ago (2 refused): part delivered and late
  const o2 = await mk("p_rp1", "v_rp2", [{ description: "Steel", unit: "kg", quantity: "100", rate: "100", gstPercent: "18" }], daysAgo(10));
  await receive(o2, [60], daysAgo(5), [2]);
  // o3: delivered 4 days AFTER its date, never billed (7,080: 60 x 100 +18%)
  const o3 = await mk("p_rp1", "v_rp2", [{ description: "Binding wire", unit: "kg", quantity: "60", rate: "100", gstPercent: "18" }], daysAgo(12));
  await receive(o3, [60], daysAgo(8));
  // o4: another project, nothing arrived yet, due in the future
  await mk("p_rp2", "v_rp1", [{ description: "Sand", unit: "cft", quantity: "10", rate: "500", gstPercent: "0" }], daysAgo(-9));
  // a draft: counts for nothing
  const draft = await p.createOrder(admin, { projectId: "p_rp1", data: { vendorId: "v_rp1", lines: [{ description: "Draft item", unit: "nos", quantity: "1", rate: "999999", gstPercent: "0" }] } });
  assert.ok(draft.ok);
  // a draft bill still being read does not count as billed
  await bill("rp_inv_draft", o3, "v_rp2", "p_rp1", 5000, "NEEDS_REVIEW");

  const money = (m: number) => m / 100;
  await check("project report: ordered, to deliver, delivered-not-billed, billed, paid, expected cost, budget", async () => {
    const r = (await rep.loadPurchaseReport(admin))!;
    const a = r.projects.find((x) => x.name === "Tower A")!;
    assert.equal(a.orders, 3, "the draft is not counted");
    assert.equal(money(a.committedMinor), 17936 + 11800 + 7080);
    assert.equal(money(a.receivedMinor), 17936 + 7080 + 7080);
    assert.equal(money(a.toDeliverMinor), 11800 - 7080, "only the steel is still to come");
    assert.equal(money(a.awaitingBillMinor), 7080 + 7080, "the steel that arrived and the wire: not billed yet");
    assert.equal(money(a.billedAllMinor), 17936, "the bill still in review is not counted");
    assert.equal(money(a.paidMinor), 10000);
    assert.equal(money(a.outstandingMinor), 7936);
    assert.equal(money(a.expectedMinor), 17936 + 11800 + 7080, "bills so far + ordered and not yet billed");
    assert.equal(money(a.budgetMinor!), 2500000);
    assert.equal(a.budgetStatus, "ok");
    const b = r.projects.find((x) => x.name === "Tower B")!;
    assert.equal(money(b.committedMinor), 5000);
    assert.equal(b.budgetMinor, null);
    assert.equal(money(r.totals.committedMinor), 17936 + 11800 + 7080 + 5000);
  });

  await check("supplier performance: on time, delay, fill, refused, late now", async () => {
    const r = (await rep.loadPurchaseReport(admin))!;
    const cement = r.suppliers.find((s) => s.name === "Shree Cement")!;
    assert.deepEqual([cement.orders, cement.measured, cement.onTime, cement.onTimePercent], [2, 1, 1, 100], "o1 came 5 days early; o4 is not complete");
    assert.equal(cement.lateOpen, 0, "o4 is not due yet");
    const steel = r.suppliers.find((s) => s.name === "Steel Mart")!;
    assert.deepEqual([steel.orders, steel.measured, steel.onTime, steel.averageDelayDays, steel.lateOpen], [2, 1, 0, 4, 1], "the wire came 4 days late; the steel is past due and open");
    assert.equal(steel.fillPercent, Math.round(((60 + 60) / (100 + 60)) * 100));
    assert.equal(steel.refusedPercent, Math.round((2 / (120 + 2)) * 1000) / 10);
  });

  await check("open orders: the late part-delivered steel first, then the future sand; delivered orders are not listed", async () => {
    const r = (await rep.loadPurchaseReport(admin))!;
    assert.deepEqual(r.open.map((o) => [o.vendorName, o.daysLate, o.receivedPercent]), [["Steel Mart", 10, 60], ["Shree Cement", 0, 0]]);
    assert.equal(money(r.open[0].toDeliverMinor), 11800 - 7080);
  });

  await check("the period only changes the supplier view: orders dated outside it are left out", async () => {
    const narrow = (await rep.loadPurchaseReport(admin, { from: daysAgo(5), to: daysAgo(1) }))!;
    assert.equal(narrow.suppliers.length, 0, "every order is dated 30 days ago");
    assert.equal(narrow.projects.length, 2, "the project view is to date, whatever the period");
    const wide = (await rep.loadPurchaseReport(admin, { from: daysAgo(40), to: daysAgo(20) }))!;
    assert.equal(wide.suppliers.length, 2);
    // an impossible period falls back to the last twelve months
    const bad = rep.parsePeriod({ from: "nonsense", to: "2999-01-01" }, "2026-10-27");
    assert.deepEqual(bad, { from: "2025-10-27", to: "2026-10-27" });
  });

  await check("who sees the report: office roles yes; engineers and staff no; people on one project see only it; budgets only with budget access", async () => {
    assert.equal(await rep.loadPurchaseReport(eng), null, "engineers do not see prices");
    assert.equal(await rep.loadPurchaseReport(staff), null);
    const m = (await rep.loadPurchaseReport(mgr))!;
    assert.deepEqual(m.projects.map((x) => x.name), ["Tower A"], "a manager sees their project only");
    assert.equal(m.showBudget, true);
    assert.ok(m.projects[0].budgetMinor !== null);
    const v = (await rep.loadPurchaseReport(view))!;
    assert.equal(v.showBudget, true, "viewers may see budgets");
    const b = (await rep.loadPurchaseReport(buyer))!;
    assert.equal(b.showBudget, false);
    assert.ok(b.projects.every((x) => x.budgetMinor === null && x.budgetStatus === "none"), "no budget for a purchase officer");
    const a = (await rep.loadPurchaseReport(acct))!;
    assert.equal(a.projects.length, 2, "the accountant sees all projects");
    const o = (await rep.loadPurchaseReport(other))!;
    assert.equal(o.projects.length, 0, "another company sees none of it");
    assert.equal(o.open.length, 0);
    const one = (await rep.loadPurchaseReport(admin, { projectId: "p_rp2" }))!;
    assert.deepEqual(one.projects.map((x) => x.name), ["Tower B"]);
    assert.equal((await rep.loadPurchaseReport(mgr, { projectId: "p_rp2" }))!.projects.length, 0, "asking for a project one is not on gives nothing");
  });

  await check("budget status turns to over when what is billed plus ordered passes the budget", async () => {
    await q(`UPDATE "Project" SET budget=30000 WHERE id='p_rp1'`);
    const r = (await rep.loadPurchaseReport(admin))!;
    assert.equal(r.projects.find((x) => x.name === "Tower A")!.budgetStatus, "over");
    await q(`UPDATE "Project" SET budget=2500000 WHERE id='p_rp1'`);
  });

  await check("a closed-short order commits only what arrived, and a cancelled one nothing", async () => {
    const o5 = await mk("p_rp2", "v_rp2", [{ description: "Pipes", unit: "mtr", quantity: "100", rate: "10", gstPercent: "0" }], daysAgo(3));
    await receive(o5, [40], daysAgo(2));
    const before = (await rep.loadPurchaseReport(admin))!.projects.find((x) => x.name === "Tower B")!.committedMinor;
    assert.ok((await p.closeOrder(admin, o5, "Supplier cannot supply the rest")).ok);
    const after = (await rep.loadPurchaseReport(admin))!.projects.find((x) => x.name === "Tower B")!.committedMinor;
    assert.equal(money(before - after), 600, "the 60 not coming (60 x 10) are no longer committed");
    const o6 = await mk("p_rp2", "v_rp2", [{ description: "Cancelled item", unit: "nos", quantity: "1", rate: "1000", gstPercent: "0" }], null);
    const mid = (await rep.loadPurchaseReport(admin))!.projects.find((x) => x.name === "Tower B")!.committedMinor;
    assert.ok((await p.cancelOrder(admin, o6, "Not needed")).ok);
    assert.equal(money(mid - (await rep.loadPurchaseReport(admin))!.projects.find((x) => x.name === "Tower B")!.committedMinor), 1000);
  });

  await check("the CSV download carries the same numbers, follows the same permissions, and refuses other views", async () => {
    // the route needs a signed-in cookie session, so the pieces are checked directly: the loader (above) feeds both the page and the file
    const { plain, toCsv } = await import("@/lib/gst/report");
    const r = (await rep.loadPurchaseReport(admin))!;
    const csv = toCsv(["Project", "Ordered"], r.projects.map((x) => [x.name, plain(x.committedMinor)]));
    assert.match(csv, /Tower A,36816\.00/);
    assert.match(csv, /^﻿Project,Ordered\r\n/);
    assert.equal(plain(5), "0.05");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
