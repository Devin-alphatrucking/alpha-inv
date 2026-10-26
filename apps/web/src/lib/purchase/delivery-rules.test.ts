// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { lineProgress, matchInvoice, matchLine, orderProgress, parseQuantityOrZero, parseReceipt, type MatchOrderLine } from "./delivery-rules";

const TODAY = "2026-10-26";
assert.equal(parseQuantityOrZero(""), 0);
assert.equal(parseQuantityOrZero("12.5"), 12500);
assert.equal(parseQuantityOrZero("0"), 0);
for (const b of ["-1", "x", "1.2345", "12345678"]) assert.equal(parseQuantityOrZero(b), null, b);

// ---- receipt
const ids = ["l1", "l2", "l3"];
const ok = parseReceipt({ receivedOn: "2026-10-25", challanNo: " CH-77 ", lines: [{ orderLineId: "l1", quantity: "30", rejected: "2", remark: "2 bags torn" }, { orderLineId: "l2", quantity: "", rejected: "" }] }, TODAY, ids);
assert.ok(ok.ok && ok.value.lines.length === 1 && ok.value.lines[0].quantityMilli === 30000 && ok.value.lines[0].rejectedMilli === 2000 && ok.value.challanNo === "CH-77", "lines with nothing are dropped");
assert.ok(parseReceipt({ lines: [{ orderLineId: "l1", quantity: "1" }] }, TODAY, ids).ok, "date defaults to today");
assert.ok(!parseReceipt({ receivedOn: "2026-10-27", lines: [{ orderLineId: "l1", quantity: "1" }] }, TODAY, ids).ok, "future");
assert.ok(!parseReceipt({ receivedOn: "2026-02-30", lines: [{ orderLineId: "l1", quantity: "1" }] }, TODAY, ids).ok);
assert.ok(!parseReceipt({ lines: [] }, TODAY, ids).ok, "nothing arrived");
assert.ok(!parseReceipt({ lines: [{ orderLineId: "l1", quantity: "0", rejected: "0" }] }, TODAY, ids).ok);
assert.ok(!parseReceipt({ lines: [{ orderLineId: "zzz", quantity: "1" }] }, TODAY, ids).ok, "not on this order");
assert.ok(!parseReceipt({ lines: [{ orderLineId: "l1", quantity: "1" }, { orderLineId: "l1", quantity: "2" }] }, TODAY, ids).ok, "twice");
assert.ok(!parseReceipt({ lines: [{ orderLineId: "l1", quantity: "abc" }] }, TODAY, ids).ok);
assert.ok(!parseReceipt({ challanNo: "x".repeat(61), lines: [{ orderLineId: "l1", quantity: "1" }] }, TODAY, ids).ok);
assert.ok(parseReceipt({ lines: [{ orderLineId: "l1", quantity: "0", rejected: "3" }] }, TODAY, ids).ok, "a delivery that was all refused is still recorded");
assert.ok(!parseReceipt(null, TODAY, ids).ok);

// ---- progress
assert.equal(lineProgress(40000, 0), "NONE");
assert.equal(lineProgress(40000, 10000), "PARTLY");
assert.equal(lineProgress(40000, 40000), "FULL");
assert.equal(lineProgress(40000, 41000), "OVER");
assert.equal(orderProgress([]), "NOT_RECEIVED");
assert.equal(orderProgress([{ orderedMilli: 10, receivedMilli: 0 }, { orderedMilli: 10, receivedMilli: 0 }]), "NOT_RECEIVED");
assert.equal(orderProgress([{ orderedMilli: 10, receivedMilli: 10 }, { orderedMilli: 10, receivedMilli: 3 }]), "PARTLY");
assert.equal(orderProgress([{ orderedMilli: 10, receivedMilli: 12 }, { orderedMilli: 10, receivedMilli: 10 }]), "RECEIVED");

// ---- line matching
const order: MatchOrderLine[] = [
  { id: "l1", description: "Cement OPC 53 Grade", unit: "BAG", quantityMilli: 40000, rateMinor: 38000, materialId: null, receivedMilli: 30000 },
  { id: "l2", description: "TMT bar 12mm", unit: "KG", quantityMilli: 1500000, rateMinor: 6450, materialId: "m_tmt", receivedMilli: 0 },
];
assert.equal(matchLine({ description: "CEMENT  opc-53 grade" }, order), "l1", "case, spaces and dashes do not matter");
assert.equal(matchLine({ description: "OPC 53 Grade" }, order), "l1", "part of the ordered name");
assert.equal(matchLine({ description: "Cement OPC 53 Grade Premium" }, order), "l1", "ordered name inside the billed name");
assert.equal(matchLine({ description: "Steel rods", materialId: "m_tmt" }, order), "l2", "same material wins");
assert.equal(matchLine({ description: "Sand" }, order), null);
assert.equal(matchLine({ description: "ce" }, order), null, "very short names do not match by accident");
assert.equal(matchLine({ description: "" }, order), null);

// ---- invoice match
const base = { orderLines: order, orderSubtotalMinor: 40 * 38000 + 1500 * 6450, invoicedBefore: {}, invoicedBeforeSubtotalMinor: 0 };
const inv = (lines: { description: string; quantityMilli: number; rateMinor: number }[]) => ({ invoiceLines: lines.map((l) => ({ ...l, materialId: null })), invoiceSubtotalMinor: lines.reduce((s, l) => s + Math.round((l.quantityMilli * l.rateMinor) / 1000), 0) });

const clean = matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 38000 }]) });
assert.equal(clean.status, "OK", JSON.stringify(clean));

const over = matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 35000, rateMinor: 38000 }]) });
assert.equal(over.status, "MISMATCH");
assert.deepEqual(over.findings.map((f) => f.kind), ["quantity_over_received"]);

const tooMany = matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 41000, rateMinor: 38000 }]) });
assert.deepEqual(tooMany.findings.map((f) => f.kind), ["quantity_over_ordered"], "ordered limit is reported instead of the received one");

const rate = matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 40000 }]) });
assert.deepEqual(rate.findings.map((f) => f.kind), ["rate_higher"]);
assert.equal(matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 38300 }]) }).status, "OK", "within 1% is fine");
assert.equal(matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 30000 }]) }).status, "OK", "cheaper is fine");

const extra = matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 38000 }, { description: "Binding wire", quantityMilli: 10000, rateMinor: 9500 }]) });
assert.deepEqual(extra.findings.map((f) => f.kind), ["not_on_order"]);

const notYet = matchInvoice({ ...base, ...inv([{ description: "TMT bar 12mm", quantityMilli: 500000, rateMinor: 6450 }]) });
assert.equal(notYet.status, "CHECK");
assert.deepEqual(notYet.findings.map((f) => f.kind), ["not_received"], "a note, not a problem");

const second = matchInvoice({ ...base, invoicedBefore: { l1: 20000 }, invoicedBeforeSubtotalMinor: 20 * 38000, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 15000, rateMinor: 38000 }]) });
assert.deepEqual(second.findings.map((f) => f.kind), ["quantity_over_received"], "earlier bills count: 20 + 15 is more than the 30 received");

const total = matchInvoice({ ...base, invoicedBeforeSubtotalMinor: base.orderSubtotalMinor, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 10000, rateMinor: 38000 }]) });
assert.ok(total.findings.some((f) => f.kind === "total_higher"));
assert.ok(!matchInvoice({ ...base, ...inv([{ description: "Cement OPC 53 Grade", quantityMilli: 30000, rateMinor: 38000 }]) }).findings.some((f) => f.kind === "total_higher"));

console.log("delivery rules: all checks passed");
