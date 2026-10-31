import assert from "node:assert/strict";
import { amountInWords, cleanPrefix, computeInvoice, csvCell, financialYear, invoiceNumber, isOverdue, statusFromReceipts, toPaise } from "./rules";

const line = (o: Partial<Parameters<typeof computeInvoice>[0]["lines"][number]> = {}) => ({ description: "Cement 53 grade", hsnSac: "2523", quantity: 10, unit: "Bag", rate: 100, gstPercent: 18, ...o });
const calc = (lines = [line()], seller = "27", place = "27") => computeInvoice({ lines, sellerState: seller, placeOfSupply: place });
const must = <T extends { ok: boolean }>(r: T) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

// same state: CGST + SGST halves
let r = must(calc());
assert.equal(r.supply, "intra");
assert.deepEqual([r.taxable, r.cgst, r.sgst, r.igst, r.total, r.roundOff], [1000, 90, 90, 0, 1180, 0]);
// another state: IGST
r = must(calc([line()], "27", "29"));
assert.equal(r.supply, "inter");
assert.deepEqual([r.cgst, r.sgst, r.igst, r.total], [0, 0, 180, 1180]);

// discount before tax
r = must(calc([line({ discountPercent: 10 })]));
assert.deepEqual([r.taxable, r.cgst + r.sgst, r.total], [900, 162, 1062]);

// odd paise: halves add back to the tax; total is rounded to a whole rupee and the difference is the round-off
r = must(calc([line({ quantity: 3, rate: 33.33, gstPercent: 5 })])); // taxable 99.99, tax 5.00 (499.95 paise -> 500)
assert.equal(r.taxable, 99.99);
assert.equal(r.cgst + r.sgst, 5);
assert.equal(r.total, 105);
assert.equal(toPaise(r.taxable + r.cgst + r.sgst + r.roundOff), toPaise(r.total));
const odd = must(calc([line({ quantity: 1, rate: 100.01, gstPercent: 5 })])); // tax 5.0005 -> 5.00; raw 105.01
assert.equal(odd.total, 105);
assert.equal(odd.roundOff, -0.01);
// a tax of an odd number of paise: one half gets the extra paisa, never lost
const halves = must(calc([line({ quantity: 1, rate: 0.35, hsnSac: null, gstPercent: 5 })])); // taxable 0.35, tax 0.0175 -> 0.02
assert.equal(toPaise(halves.cgst) + toPaise(halves.sgst), 2);

// many lines never drift
const many = must(calc(Array.from({ length: 50 }, () => line({ quantity: 1, rate: 0.07, gstPercent: 18, hsnSac: null }))));
assert.equal(toPaise(many.taxable), 350);
assert.equal(toPaise(many.total), Math.round((many.taxable * 100 + (many.cgst + many.sgst) * 100) / 100) * 100);

// zero rate GST and exempt lines
r = must(calc([line({ gstPercent: 0 })]));
assert.deepEqual([r.cgst, r.sgst, r.igst, r.total], [0, 0, 0, 1000]);

// refusals say what is wrong
const bad = (lines: Parameters<typeof calc>[0], seller = "27", place = "27") => {
  const x = calc(lines, seller, place);
  assert.equal(x.ok, false);
  return (x as { error: string }).error;
};
assert.match(bad([]), /at least one item/);
assert.match(bad([line({ description: "  " })]), /Item 1: write what was sold/);
assert.match(bad([line({ quantity: 0 })]), /quantity/);
assert.match(bad([line({ rate: -1 })]), /rate/);
assert.match(bad([line({ discountPercent: 120 })]), /discount/);
assert.match(bad([line({ gstPercent: 99 })]), /GST rate/);
assert.match(bad([line({ hsnSac: "12" })]), /HSN/);
assert.match(bad([line()], "", "27"), /state is not set/);
assert.match(bad([line()], "27", ""), /place of supply/);
assert.match(bad([line(), line({ unit: "" })]), /Item 2: write the unit/);

// financial year and numbers
assert.deepEqual(financialYear("2026-03-31"), { start: 2025, label: "2025-26" });
assert.deepEqual(financialYear("2026-04-01"), { start: 2026, label: "2026-27" });
assert.deepEqual(financialYear("2026-12-31"), { start: 2026, label: "2026-27" });
assert.deepEqual(financialYear("2099-04-01"), { start: 2099, label: "2099-00" });
assert.equal(invoiceNumber("INV", "2026-27", 7), "INV/2026-27/0007");
assert.equal(invoiceNumber("SAN", "2026-27", 12345), "SAN/2026-27/12345");
assert.equal(cleanPrefix(" inv "), "INV");
assert.equal(cleanPrefix("a/b"), null);
assert.equal(cleanPrefix(""), null);
assert.equal(cleanPrefix("TOOLONGPREFIX"), null);

// status
assert.equal(statusFromReceipts(1000, 0, false), "ISSUED");
assert.equal(statusFromReceipts(1000, 400, false), "PARTIALLY_PAID");
assert.equal(statusFromReceipts(1000, 1000, false), "PAID");
assert.equal(statusFromReceipts(1000, 1000.01, false), "PAID");
assert.equal(statusFromReceipts(1000, 400, true), "CANCELLED");
assert.equal(isOverdue("2026-11-01", "2026-11-05", "ISSUED"), true);
assert.equal(isOverdue("2026-11-05", "2026-11-05", "ISSUED"), false, "due today is not late");
assert.equal(isOverdue("2026-11-01", "2026-11-05", "PAID"), false);
assert.equal(isOverdue("2026-11-01", "2026-11-05", "CANCELLED"), false);
assert.equal(isOverdue(null, "2026-11-05", "ISSUED"), false);

// amount in words (lakh and crore)
assert.equal(amountInWords(0), "Rupees Zero Only");
assert.equal(amountInWords(1180), "Rupees One Thousand One Hundred Eighty Only");
assert.equal(amountInWords(123456.78), "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Paise Seventy Eight Only");
assert.equal(amountInWords(10_000_000), "Rupees One Crore Only");
assert.equal(amountInWords(25_00_00_000 + 5), "Rupees Twenty Five Crore Five Only");
assert.equal(amountInWords(100000), "Rupees One Lakh Only");
assert.equal(amountInWords(0.5), "Rupees Zero and Paise Fifty Only");
assert.equal(amountInWords(19), "Rupees Nineteen Only");

// csv safety
assert.equal(csvCell("Shree, Traders"), '"Shree, Traders"');
assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
assert.equal(csvCell("@cmd"), "'@cmd");
assert.equal(csvCell(-5), "-5", "a real negative number stays a number");
assert.equal(csvCell(null), "");

console.log("sales rules: all checks passed");
