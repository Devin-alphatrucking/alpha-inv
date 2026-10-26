// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { buildGstReport, csvCell, financialYearOf, financialYearRange, parsePeriod, plain, toCsv, type GstInvoice } from "./report";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const inv = (o: Partial<GstInvoice> & { vendorId?: string }): GstInvoice => ({
  id: `i${++n}`, invoiceNumber: `N-${n}`, invoiceDate: d("2026-09-10"), vendorId: "v1", vendorName: "Vendor One", vendorGstin: "27AAAAA0000A1Z5", projectName: "P",
  subtotal: 1000, cgst: 90, sgst: 90, igst: 0, rounding: 0, total: 1180, status: "UNPAID", ...o,
});

// ---- totals, months, vendors
const r = buildGstReport([
  inv({}),
  inv({ invoiceDate: d("2026-09-25"), subtotal: 500, cgst: 45, sgst: 45, total: 590 }),
  inv({ invoiceDate: d("2026-10-02"), vendorId: "v2", vendorName: "Vendor Two", vendorGstin: "29BBBBB1111B1Z6", subtotal: 2000, cgst: 0, sgst: 0, igst: 360, total: 2360 }),
]);
assert.equal(r.totals.invoices, 3);
assert.equal(r.totals.taxableMinor, 350_000);
assert.equal(r.totals.cgstMinor, 13_500);
assert.equal(r.totals.sgstMinor, 13_500);
assert.equal(r.totals.igstMinor, 36_000);
assert.equal(r.totals.taxMinor, 63_000);
assert.equal(r.totals.totalMinor, 413_000);
assert.deepEqual(r.months.map((m) => [m.month, m.invoices, m.taxMinor]), [["2026-09", 2, 27_000], ["2026-10", 1, 36_000]]);
assert.deepEqual(r.vendors.map((v) => v.name), ["Vendor Two", "Vendor One"], "biggest tax first");
assert.equal(r.vendors[1].invoices, 2);
assert.equal(r.mismatched.length, 0);
assert.equal(r.missingGstin.count, 0);

// ---- money never drifts (0.1 + 0.2 style sums)
const drift = buildGstReport([inv({ subtotal: 0.1, cgst: 0.1, sgst: 0.2, total: 0.4 }), inv({ subtotal: 0.2, cgst: 0.2, sgst: 0.1, total: 0.5 })]);
assert.equal(drift.totals.cgstMinor, 30);
assert.equal(drift.totals.sgstMinor, 30);

// ---- missing GSTIN only matters when there is tax
const m = buildGstReport([inv({ vendorGstin: null }), inv({ vendorGstin: "  ", cgst: 0, sgst: 0, total: 1000 }), inv({ vendorGstin: null, cgst: 0, sgst: 0, igst: 180, total: 1180 })]);
assert.deepEqual(m.missingGstin, { count: 2, taxMinor: 18_000 + 18_000 });
assert.equal(m.vendors[0].gstin, null);

// ---- amounts that do not add up (one rupee of slack)
const bad = buildGstReport([inv({ total: 1181 }), inv({ total: 1200 }), inv({ total: 1180.4, rounding: 0.4 }), inv({ total: 1179.5 })]);
assert.deepEqual(bad.mismatched.map((x) => x.differenceMinor), [2000], "only the 20 rupee gap is flagged; 1.00, 0.50 and a stated rounding are fine");

// ---- financial years
assert.equal(financialYearOf("2026-04-01"), 2026);
assert.equal(financialYearOf("2026-03-31"), 2025);
assert.equal(financialYearOf("2027-01-15"), 2026);
assert.deepEqual(financialYearRange(2026), { from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" });
assert.equal(financialYearRange(2099).label, "FY 2099-00");

// ---- period input
assert.equal(parsePeriod({}, "2026-10-23").from, "2026-04-01");
assert.equal(parsePeriod({}, "2027-02-01").from, "2026-04-01");
assert.equal(parsePeriod({ fy: "2025" }, "2026-10-23").to, "2026-03-31");
assert.equal(parsePeriod({ fy: "abc" }, "2026-10-23").from, "2026-04-01", "bad year falls back");
assert.equal(parsePeriod({ fy: "1850" }, "2026-10-23").from, "2026-04-01");
const custom = parsePeriod({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-23");
assert.deepEqual([custom.from, custom.to, custom.custom], ["2026-09-01", "2026-09-30", true]);
assert.equal(parsePeriod({ from: "2026-09-30", to: "2026-09-01" }, "2026-10-23").custom, false, "backwards range");
assert.equal(parsePeriod({ from: "2026-02-30", to: "2026-03-01" }, "2026-10-23").custom, false, "no such date");
assert.equal(parsePeriod({ from: "2026-09-01" }, "2026-10-23").custom, false, "needs both ends");
assert.equal(parsePeriod({ from: "2000-01-01", to: "2026-01-01" }, "2026-10-23").custom, false, "longer than five years");

// ---- CSV
assert.equal(csvCell("plain"), "plain");
assert.equal(csvCell('He said "hi", twice'), '"He said ""hi"", twice"');
assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"', "formula text is made harmless");
assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
assert.equal(csvCell("+91 98765"), "'+91 98765");
assert.equal(csvCell("-5.00"), "-5.00", "a negative amount stays a number");
assert.equal(csvCell(-5), "-5");
assert.equal(csvCell(null), "");
assert.equal(plain(123_456), "1234.56");
assert.equal(plain(-50), "-0.50");
const csv = toCsv(["A", "B"], [["x", 1], ["y,z", null]]);
assert.ok(csv.startsWith("﻿A,B\r\n"));
assert.ok(csv.endsWith('"y,z",\r\n'));

// ---- GSTIN, mixed tax and split checks
import { gstinCheckChar } from "./gstin";
const valid = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
const goodGstin = valid("27AABCS1234F1Z");
const checks = buildGstReport([
  inv({ vendorId: "ok", vendorName: "Good Co", vendorGstin: goodGstin }),
  inv({ vendorId: "bad1", vendorName: "Typo Co", vendorGstin: "27AABCS1234F1Z5", cgst: 90, sgst: 90 }), // wrong check character
  inv({ vendorId: "bad1", vendorName: "Typo Co", vendorGstin: "27AABCS1234F1Z5", cgst: 10, sgst: 10, total: 1020 }),
  inv({ vendorId: "bad2", vendorName: "Short Co", vendorGstin: "27AAB", cgst: 0, sgst: 0, igst: 180, total: 1180 }),
  inv({ vendorId: "none", vendorName: "No Gstin Co", vendorGstin: null }), // missing is reported elsewhere, not as invalid
  inv({ vendorId: "blank", vendorName: "Blank Co", vendorGstin: "  - " }),
  inv({ vendorId: "ok", vendorName: "Good Co", vendorGstin: goodGstin, cgst: 90, sgst: 0, igst: 90, total: 1180 }), // both kinds of tax
  inv({ vendorId: "ok", vendorName: "Good Co", vendorGstin: goodGstin, cgst: 100, sgst: 80, total: 1180 }), // halves differ
  inv({ vendorId: "ok", vendorName: "Good Co", vendorGstin: goodGstin, cgst: 90, sgst: 90.01, total: 1180.01 }), // a paisa apart is fine
]);
assert.deepEqual(checks.invalidGstin.map((x) => [x.vendorId, x.invoices, x.taxMinor]), [["bad1", 2, 20_000], ["bad2", 1, 18_000]], "one row per supplier, biggest tax first");
assert.match(checks.invalidGstin[0].reason, /last character/);
assert.match(checks.invalidGstin[1].reason, /15 characters/);
assert.ok(!checks.invalidGstin.some((x) => ["ok", "none", "blank"].includes(x.vendorId)), "valid, missing and blank are not 'invalid'");
assert.equal(checks.mixedTax.length, 1);
assert.equal(checks.mixedTax[0].vendorName, "Good Co");
assert.deepEqual(checks.splitMismatch.map((x) => [x.cgstMinor, x.sgstMinor]), [[10_000, 8_000]]);
assert.ok(!checks.splitMismatch.some((x) => x.cgstMinor === 9_000 && x.sgstMinor === 9_001), "one paisa of difference is allowed");
assert.deepEqual(buildGstReport([]).invalidGstin, []);

console.log("gst report: all checks passed");
