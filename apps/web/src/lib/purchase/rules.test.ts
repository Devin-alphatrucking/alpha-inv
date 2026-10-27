// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { documentNumber, isOpenForGoods, lineAmount, orderActions, parseClose, statusForProgress, orderTotals, parseCancelReason, parseDecision, parseGst, parseMoney, parseOrder, parseQuantity, parseRequest, requestActions } from "./rules";

const TODAY = "2026-10-26";

// ---- numbers
assert.equal(parseQuantity("12.5"), 12500);
assert.equal(parseQuantity("1,000"), 1000000);
assert.equal(parseQuantity(40), 40000);
for (const bad of ["0", "-1", "abc", "1.2345", "", "12345678", null, "1e3"]) assert.equal(parseQuantity(bad), null, String(bad));
assert.equal(parseMoney("1250.50"), 125050);
assert.equal(parseMoney("0.07"), 7);
assert.equal(parseMoney("19.99"), 1999, "no floating point loss");
for (const bad of ["0", "0.00", "-5", "1.234", "x", "", "123456789"]) assert.equal(parseMoney(bad), null, String(bad));
assert.equal(parseGst(""), 0);
assert.equal(parseGst("18"), 1800);
assert.equal(parseGst("2.5"), 250);
assert.equal(parseGst("41"), null);
assert.equal(parseGst("-1"), null);
assert.equal(parseGst("abc"), null);

// ---- totals
assert.deepEqual(lineAmount(40000, 38000, 1800), { amountMinor: 1_520_000, gstMinor: 273_600, totalMinor: 1_793_600 }); // 40 bags at 380.00 + 18%
assert.deepEqual(lineAmount(1500, 3333, 500), { amountMinor: 5000, gstMinor: 250, totalMinor: 5250 }); // 1.5 x 33.33 = 49.995 -> 50.00
assert.deepEqual(orderTotals([{ quantityMilli: 1000, rateMinor: 10000, gstBps: 1800 }, { quantityMilli: 2000, rateMinor: 5000, gstBps: 0 }]), { subtotalMinor: 20000, gstMinor: 1800, totalMinor: 21800 });
assert.deepEqual(orderTotals([]), { subtotalMinor: 0, gstMinor: 0, totalMinor: 0 });

// ---- request
const line = { description: "Cement OPC 53", unit: "bag", quantity: "40" };
const r = parseRequest({ neededBy: "2026-11-01", note: " for slab ", lines: [line] }, TODAY);
assert.ok(r.ok && r.value.lines[0].unit === "BAG" && r.value.lines[0].quantityMilli === 40000 && r.value.note === "for slab");
assert.ok(!parseRequest({ lines: [] }, TODAY).ok, "no items");
assert.ok(!parseRequest({}, TODAY).ok);
assert.ok(!parseRequest({ lines: [{ ...line, quantity: "0" }] }, TODAY).ok);
assert.ok(!parseRequest({ lines: [{ ...line, unit: "" }] }, TODAY).ok);
assert.ok(!parseRequest({ lines: [{ ...line, description: "x" }] }, TODAY).ok);
assert.ok(!parseRequest({ neededBy: "2026-10-01", lines: [line] }, TODAY).ok, "in the past");
assert.ok(!parseRequest({ neededBy: "2026-02-30", lines: [line] }, TODAY).ok);
assert.ok(parseRequest({ neededBy: "", lines: [line] }, TODAY).ok, "date is optional");
assert.ok(!parseRequest({ lines: Array.from({ length: 61 }, () => line) }, TODAY).ok);
const bad2 = parseRequest({ lines: [line, { ...line, quantity: "abc" }] }, TODAY);
assert.ok(!bad2.ok && /Line 2/.test(bad2.error), "says which line");

// ---- who may do what with a request
const who = (o: Partial<Parameters<typeof requestActions>[1]> = {}) => ({ isOwner: false, canWrite: false, canApprove: false, isAdmin: false, canOrder: false, ...o });
assert.deepEqual(requestActions("DRAFT", who({ isOwner: true, canWrite: true })), ["edit", "submit", "cancel"]);
assert.deepEqual(requestActions("DRAFT", who({ canWrite: true })), [], "someone else's draft");
assert.deepEqual(requestActions("DRAFT", who({ isAdmin: true, canWrite: true, canApprove: true })), ["edit", "submit", "cancel"], "an administrator can work on any draft");
assert.deepEqual(requestActions("SUBMITTED", who({ isOwner: true, canWrite: true })), ["withdraw", "cancel"]);
assert.deepEqual(requestActions("SUBMITTED", who({ canApprove: true })), ["approve", "reject", "cancel"]);
assert.deepEqual(requestActions("SUBMITTED", who({ isOwner: true, canWrite: true, canApprove: true })), ["withdraw", "cancel"], "a manager cannot approve their own request");
assert.deepEqual(requestActions("SUBMITTED", who({ isOwner: true, canWrite: true, canApprove: true, isAdmin: true })), ["withdraw", "approve", "reject", "cancel"]);
assert.deepEqual(requestActions("SUBMITTED", who({ canWrite: true })), [], "an engineer cannot decide or touch another's request");
assert.deepEqual(requestActions("APPROVED", who({ canOrder: true })), ["order"]);
assert.deepEqual(requestActions("APPROVED", who({ canApprove: true })), ["cancel"]);
for (const s of ["REJECTED", "ORDERED", "CANCELLED"] as const) assert.deepEqual(requestActions(s, who({ isOwner: true, canWrite: true, canApprove: true, isAdmin: true, canOrder: true })), [], s);

// ---- decisions
assert.ok(parseDecision(true, "").ok);
assert.ok(!parseDecision(false, "").ok, "a rejection needs a reason");
assert.ok(!parseDecision(false, "no").ok);
assert.ok(parseDecision(false, "Quantity looks too high").ok);
assert.ok(!parseDecision(true, "x".repeat(301)).ok);

// ---- order
const oline = { ...line, rate: "380.00", gstPercent: "18" };
const o = parseOrder({ vendorId: "v1", orderDate: "2026-10-26", deliveryDate: "2026-10-30", paymentTerms: " 30 days ", lines: [oline] }, TODAY);
assert.ok(o.ok && o.value.lines[0].rateMinor === 38000 && o.value.lines[0].gstBps === 1800 && o.value.paymentTerms === "30 days");
assert.ok(parseOrder({ vendorId: "v1", lines: [oline] }, TODAY).ok && (parseOrder({ vendorId: "v1", lines: [oline] }, TODAY) as { value: { orderDate: string } }).value.orderDate === TODAY, "order date defaults to today");
assert.ok(!parseOrder({ lines: [oline] }, TODAY).ok, "no supplier");
assert.ok(!parseOrder({ vendorId: "v1", lines: [{ ...oline, rate: "" }] }, TODAY).ok, "no rate");
assert.ok(!parseOrder({ vendorId: "v1", lines: [{ ...oline, gstPercent: "50" }] }, TODAY).ok);
assert.ok(!parseOrder({ vendorId: "v1", orderDate: "2026-10-26", deliveryDate: "2026-10-01", lines: [oline] }, TODAY).ok, "delivery before order");
assert.ok(!parseOrder({ vendorId: "v1", note: "x".repeat(1001), lines: [oline] }, TODAY).ok);
assert.ok(!parseOrder({ vendorId: "v1", lines: [] }, TODAY).ok);

assert.deepEqual(orderActions("DRAFT", true), ["edit", "send", "cancel"]);
assert.deepEqual(orderActions("SENT", true), ["cancel"]);
assert.deepEqual(orderActions("CANCELLED", true), []);
assert.deepEqual(orderActions("PART_DELIVERED", true), ["close"], "once goods arrive it cannot be cancelled, only closed");
assert.deepEqual(orderActions("DELIVERED", true), ["close"]);
assert.deepEqual(orderActions("CLOSED", true), []);
assert.deepEqual(orderActions("DELIVERED", false), []);
assert.equal(statusForProgress("NOT_RECEIVED"), "SENT");
assert.equal(statusForProgress("PARTLY"), "PART_DELIVERED");
assert.equal(statusForProgress("RECEIVED"), "DELIVERED");
for (const s of ["SENT", "PART_DELIVERED", "DELIVERED"]) assert.equal(isOpenForGoods(s), true, s);
for (const s of ["DRAFT", "CLOSED", "CANCELLED"]) assert.equal(isOpenForGoods(s), false, s);
assert.ok(!parseClose(true, "").ok, "closing short needs a reason");
assert.ok(parseClose(true, "Supplier cannot supply the rest").ok);
assert.ok(parseClose(false, "").ok, "a fully delivered order closes without one");
assert.ok(!parseClose(false, "x".repeat(301)).ok);
assert.deepEqual(orderActions("DRAFT", false), []);
assert.ok(!parseCancelReason("").ok);
assert.ok(parseCancelReason("Supplier out of stock").ok);

assert.equal(documentNumber("PO", 2026, 7), "PO-2026-0007");
assert.equal(documentNumber("MR", 2026, 12345), "MR-2026-12345");

console.log("purchase rules: all checks passed");
