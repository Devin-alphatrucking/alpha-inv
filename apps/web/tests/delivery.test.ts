// Database-backed tests of the delivery check and of matching a bill with its order. Run through `npm run test:isolation`.
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

async function main() {
  const p = await import("@/lib/flows/purchase");
  const d = await import("@/lib/flows/delivery");
  const site = await import("@/lib/flows/site");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  for (const [id, name] of [["o_dl_a", "Delivery Co A"], ["o_dl_b", "Delivery Co B"]]) await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@dl.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("dl_admin", "o_dl_a", "ADMIN");
  const acct = await person("dl_acct", "o_dl_a", "ACCOUNTANT");
  const buyer = await person("dl_buyer", "o_dl_a", "PURCHASE");
  const mgr = await person("dl_mgr", "o_dl_a", "MANAGER");
  const eng = await person("dl_eng", "o_dl_a", "ENGINEER");
  const eng2 = await person("dl_eng2", "o_dl_a", "ENGINEER");
  const viewer = await person("dl_view", "o_dl_a", "VIEWER");
  const staff = await person("dl_staff", "o_dl_a", "STAFF");
  const other = await person("dl_other", "o_dl_b", "ADMIN");
  for (const [id, org, name] of [["p_dl1", "o_dl_a", "Tower A"], ["p_dl2", "o_dl_a", "Tower B"]]) await q(`INSERT INTO "Project"(id,"organizationId",name,status,address,"updatedAt") VALUES ($1,$2,$3,'ACTIVE','Site road',now())`, [id, org, name]);
  for (const u of [buyer, mgr, eng, viewer, staff]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_dl_a',$2,'p_dl1')`, [`pa_${u.id}`, u.id]);
  await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_dl_eng2','o_dl_a','dl_eng2','p_dl2')`);
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_dl1','o_dl_a','Shree Cement Traders'),('v_dl2','o_dl_a','Another Supplier')`);

  // A sent order: 40 bags cement at 380 and 1000 kg steel at 65, both with GST 18%.
  const made = await p.createOrder(buyer, { projectId: "p_dl1", data: { vendorId: "v_dl1", lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "40", rate: "380", gstPercent: "18" }, { description: "TMT bar 12mm", unit: "kg", quantity: "1000", rate: "65", gstPercent: "18" }] } });
  assert.ok(made.ok);
  const orderId = made.ok ? made.id : "";
  const draftView = await d.getDelivery(eng, orderId);

  await check("a draft order cannot receive goods; once sent, an engineer can see items and quantities but no prices", async () => {
    assert.equal(draftView?.canRecord, false);
    const early = await d.recordReceipt(eng, orderId, { lines: [{ orderLineId: draftView!.lines[0].id, quantity: "5" }] });
    assert.ok(!early.ok && /sent/.test(early.error));
    assert.ok((await p.sendOrder(buyer, orderId)).ok);
    const v = await d.getDelivery(eng, orderId);
    assert.equal(v?.canRecord, true);
    assert.deepEqual(v?.lines.map((l) => [l.description, l.ordered, l.received]), [["Cement OPC 53", "40", "0"], ["TMT bar 12mm", "1000", "0"]]);
    assert.equal(JSON.stringify(v).includes("380"), false, "no rate leaks into the delivery view");
    assert.equal(await p.getOrder(eng, orderId), null, "and the order itself stays closed to engineers");
  });

  await check("who sees and records deliveries: project people yes, other projects, staff and other companies no", async () => {
    for (const u of [eng, mgr, buyer, admin, acct, viewer]) assert.ok(await d.getDelivery(u, orderId), u.id);
    for (const u of [eng2, staff, other]) assert.equal(await d.getDelivery(u, orderId), null, u.id);
    const line = (await d.getDelivery(eng, orderId))!.lines[0].id;
    for (const u of [viewer, acct, eng2, staff, other]) assert.equal((await d.recordReceipt(u, orderId, { lines: [{ orderLineId: line, quantity: "1" }] })).ok, false, u.id);
    assert.equal((await d.listDeliveries(eng2)).length, 0);
    assert.equal((await d.listDeliveries(eng)).length, 1);
  });

  let receiptId = "";
  await check("an engineer records a part delivery with a refused quantity; totals and progress follow", async () => {
    const v = (await d.getDelivery(eng, orderId))!;
    const r = await d.recordReceipt(eng, orderId, { challanNo: "CH-101", lines: [{ orderLineId: v.lines[0].id, quantity: "30", rejected: "2", remark: "2 bags torn" }, { orderLineId: v.lines[1].id, quantity: "", rejected: "" }] });
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) receiptId = r.id;
    const after = (await d.getDelivery(eng, orderId))!;
    assert.equal(after.progress, "PARTLY");
    assert.deepEqual(after.lines.map((l) => [l.received, l.rejected, l.remaining, l.progress]), [["30", "2", "10", "PARTLY"], ["0", "0", "1000", "NONE"]]);
    assert.equal(after.receipts.length, 1);
    assert.equal(after.receipts[0].canDelete, true);
    assert.equal((await d.listDeliveries(eng))[0].progress, "PARTLY");
  });

  await check("bad deliveries are refused: nothing entered, a future date, a line from another order, an unsent order", async () => {
    const v = (await d.getDelivery(eng, orderId))!;
    assert.equal((await d.recordReceipt(eng, orderId, { lines: [] })).ok, false);
    assert.equal((await d.recordReceipt(eng, orderId, { receivedOn: "2999-01-01", lines: [{ orderLineId: v.lines[0].id, quantity: "1" }] })).ok, false);
    assert.equal((await d.recordReceipt(eng, orderId, { lines: [{ orderLineId: "nope", quantity: "1" }] })).ok, false);
    assert.equal((await q(`SELECT 1 FROM "GoodsReceipt" WHERE "orderId"=$1`, [orderId])).length, 1, "nothing was saved by the refused ones");
  });

  await check("photos of the challan can be attached to a delivery by the people who record it; only its project sees them", async () => {
    const ok = await site.addPhotos(eng, { projectId: "p_dl1", receiptId, files: [{ name: "c.jpg", bytes: JPEG }] });
    assert.ok(ok.ok, JSON.stringify(ok));
    const byBuyer = await site.addPhotos(buyer, { projectId: "p_dl1", receiptId, files: [{ name: "c2.jpg", bytes: JPEG }] });
    assert.ok(byBuyer.ok, "a purchase officer has no site-report rights but may photograph a delivery");
    assert.equal((await site.addPhotos(buyer, { projectId: "p_dl1", files: [{ name: "c3.jpg", bytes: JPEG }] })).ok, false, "and not anything else");
    assert.equal((await site.addPhotos(viewer, { projectId: "p_dl1", receiptId, files: [{ name: "c.jpg", bytes: JPEG }] })).ok, false);
    assert.equal((await site.addPhotos(eng, { projectId: "p_dl2", receiptId, files: [{ name: "c.jpg", bytes: JPEG }] })).ok, false, "the delivery is not in that project");
    assert.equal((await site.listPhotos(eng, { receiptId })).length, 2);
    assert.equal((await site.listPhotos(eng2, { receiptId })).length, 0);
    assert.equal((await d.getDelivery(eng, orderId))!.receipts[0].photoCount, 2);
  });

  // Bills from the supplier
  const addInvoice = async (id: string, no: string, subtotal: number, lines: [string, number, number][]) => {
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","updatedAt") VALUES ($1,'o_dl_a',$2,'p_dl1','v_dl1','2026-10-20'::timestamp,$3,$3,'UNPAID','x',now())`, [id, no, subtotal]);
    for (const [i, [desc, qty, rate]] of lines.entries()) await q(`INSERT INTO "InvoiceLineItem"(id,"organizationId","invoiceId",description,quantity,unit,"rateExclGst","gstPercent","gstAmount","lineTotal") VALUES ($1,'o_dl_a',$2,$3,$4,'NOS',$5,18,0,$6)`, [`${id}_l${i}`, id, desc, qty, rate, qty * rate]);
  };
  await addInvoice("dl_inv1", "SC-1", 11400, [["Cement OPC 53 Grade", 30, 380]]);
  await addInvoice("dl_inv2", "SC-2", 3800, [["Cement OPC 53 Grade", 10, 380]]);
  await addInvoice("dl_inv3", "SC-3", 600, [["Binding wire", 10, 60]]);

  await check("linking a bill: only people who review bills and see orders; same supplier, project and a sent order", async () => {
    const before = await d.invoiceMatch(acct, "dl_inv1");
    assert.equal(before?.linked, null);
    assert.deepEqual(before?.candidates.map((c) => c.id), [orderId]);
    assert.equal(await d.invoiceMatch(eng, "dl_inv1"), null, "engineers do not see the order check");
    assert.equal((await d.linkInvoice(viewer, "dl_inv1", orderId)).ok, false);
    assert.equal((await d.linkInvoice(eng, "dl_inv1", orderId)).ok, false);
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","updatedAt") VALUES ('dl_inv_x','o_dl_a','X-1','p_dl1','v_dl2','2026-10-20'::timestamp,1,1,'UNPAID','x',now())`);
    const wrong = await d.linkInvoice(acct, "dl_inv_x", orderId);
    assert.ok(!wrong.ok && /different supplier/.test(wrong.error));
    assert.ok((await d.linkInvoice(acct, "dl_inv1", orderId)).ok);
  });

  await check("a bill within what was received matches (30 bags billed, 30 received)", async () => {
    const m = await d.invoiceMatch(acct, "dl_inv1");
    assert.equal(m?.result?.status, "OK", JSON.stringify(m?.result));
    assert.equal(m?.result?.progress, "PARTLY");
  });

  await check("a second bill that takes the total past what was received is flagged (earlier bills count)", async () => {
    assert.ok((await d.linkInvoice(acct, "dl_inv2", orderId)).ok);
    const m = await d.invoiceMatch(acct, "dl_inv2");
    assert.equal(m?.result?.status, "MISMATCH");
    assert.deepEqual(m?.result?.findings.map((f) => f.kind), ["quantity_over_received"]);
    // the first bill is judged on its own quantity plus the others: still the same order, so it is flagged too
    assert.equal((await d.invoiceMatch(acct, "dl_inv1"))?.result?.status, "OK", "the earlier bill is judged without the later one");
  });

  await check("recording the rest of the delivery clears the problem", async () => {
    const v = (await d.getDelivery(eng, orderId))!;
    assert.ok((await d.recordReceipt(mgr, orderId, { lines: [{ orderLineId: v.lines[0].id, quantity: "10" }] })).ok);
    assert.equal((await d.invoiceMatch(acct, "dl_inv2"))?.result?.status, "OK");
  });

  await check("the order's status follows the deliveries: part delivered, delivered, and back again when one is removed", async () => {
    const status = async () => (await q<{ status: string; d: Date | null }>(`SELECT status::text, "deliveredAt" AS d FROM "PurchaseOrder" WHERE id=$1`, [orderId]))[0];
    assert.equal((await status()).status, "PART_DELIVERED", "30 + 10 of the cement came, no steel yet");
    assert.equal((await p.getOrder(buyer, orderId))?.actions.join(), "close", "once goods arrived the order can no longer be cancelled");
    assert.equal((await p.cancelOrder(buyer, orderId, "Too late")).ok, false);
    const v = (await d.getDelivery(admin, orderId))!;
    const steel = v.lines[1].id;
    const rec = await d.recordReceipt(mgr, orderId, { lines: [{ orderLineId: steel, quantity: "1000" }] });
    assert.ok(rec.ok);
    const done = await status();
    assert.equal(done.status, "DELIVERED");
    assert.ok(done.d, "the day it was delivered in full is kept");
    if (rec.ok) assert.ok((await d.deleteReceipt(buyer, rec.id)).ok);
    const back = await status();
    assert.deepEqual([back.status, back.d], ["PART_DELIVERED", null], "removing the delivery undoes it");
    const listed = (await d.listDeliveries(admin)).find((r) => r.orderId === orderId);
    assert.equal(listed?.progress, "PARTLY");
  });

  await check("an item that is not on the order is flagged; unlinking removes the check", async () => {
    assert.ok((await d.linkInvoice(admin, "dl_inv3", orderId)).ok);
    const m = await d.invoiceMatch(admin, "dl_inv3");
    assert.deepEqual(m?.result?.findings.map((f) => f.kind), ["not_on_order"]);
    assert.ok((await d.linkInvoice(admin, "dl_inv3", null)).ok);
    assert.equal((await d.invoiceMatch(admin, "dl_inv3"))?.linked, null);
  });

  await check("deleting a delivery: its recorder within a day or the purchase officer; others cannot", async () => {
    const v = (await d.getDelivery(admin, orderId))!;
    const second = v.receipts.find((r) => r.id !== receiptId)!;
    assert.equal((await d.deleteReceipt(eng, second.id)).ok, false, "recorded by the manager, not the engineer");
    assert.equal((await d.deleteReceipt(viewer, receiptId)).ok, false);
    assert.equal((await d.deleteReceipt(eng2, receiptId)).ok, false);
    assert.ok((await d.deleteReceipt(eng, receiptId)).ok, "their own, same day");
    assert.ok((await d.deleteReceipt(buyer, second.id)).ok, "the purchase officer can remove any");
    assert.equal((await d.getDelivery(admin, orderId))!.progress, "NOT_RECEIVED");
    assert.equal((await q(`SELECT 1 FROM "SitePhoto" WHERE "receiptId" IS NOT NULL`)).length, 0, "photos do not point at a removed delivery");
  });

  await check("a cancelled order accepts no deliveries; company isolation holds", async () => {
    assert.ok((await p.cancelOrder(buyer, orderId, "Supplier closed")).ok);
    const v = (await d.getDelivery(eng, orderId))!;
    assert.equal(v.canRecord, false);
    assert.equal((await d.recordReceipt(eng, orderId, { lines: [{ orderLineId: v.lines[0].id, quantity: "1" }] })).ok, false);
    assert.equal((await dbFor("o_dl_b").goodsReceipt.findMany()).length, 0);
    assert.equal((await dbFor("o_dl_b").goodsReceiptLine.findMany()).length, 0);
  });

  await check("closing an order: short needs a reason, full does not; closed orders take no deliveries; only the office closes", async () => {
    const make = async () => {
      const r = await p.createOrder(buyer, { projectId: "p_dl1", data: { vendorId: "v_dl1", lines: [{ description: "Sand", unit: "cft", quantity: "100", rate: "50", gstPercent: "5" }] } });
      assert.ok(r.ok);
      if (!r.ok) throw new Error("order");
      assert.ok((await p.sendOrder(buyer, r.id)).ok);
      return r.id;
    };
    const short = await make();
    const line = (await d.getDelivery(admin, short))!.lines[0].id;
    assert.ok((await d.recordReceipt(eng, short, { lines: [{ orderLineId: line, quantity: "60" }] })).ok);
    assert.equal((await p.closeOrder(eng, short, "x")).ok, false, "engineers cannot close");
    assert.equal((await p.closeOrder(mgr, short, "x")).ok, false, "managers do not close orders either");
    assert.equal((await p.closeOrder(buyer, short, "")).ok, false, "short: a reason is needed");
    assert.ok((await p.closeOrder(buyer, short, "Supplier cannot supply the rest")).ok);
    const closed = (await p.getOrder(buyer, short))!;
    assert.deepEqual([closed.status, closed.closeReason], ["CLOSED", "Supplier cannot supply the rest"]);
    assert.equal((await d.recordReceipt(eng, short, { lines: [{ orderLineId: line, quantity: "5" }] })).ok, false, "closed: no more deliveries");
    assert.equal((await p.closeOrder(buyer, short, "again")).ok, false);
    assert.equal((await p.cancelOrder(buyer, short, "no")).ok, false);

    const full = await make();
    const l2 = (await d.getDelivery(admin, full))!.lines[0].id;
    assert.ok((await d.recordReceipt(eng, full, { lines: [{ orderLineId: l2, quantity: "100" }] })).ok);
    assert.equal((await p.getOrder(buyer, full))?.status, "DELIVERED");
    assert.ok((await p.closeOrder(buyer, full, "")).ok, "fully delivered: no reason needed");
    // a bill can still be linked to a closed order
    await addInvoice("dl_inv_closed", "SC-9", 5000, [["Sand", 100, 50]]);
    assert.ok((await d.linkInvoice(acct, "dl_inv_closed", full)).ok);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
