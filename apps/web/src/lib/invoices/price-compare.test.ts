// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { comparePrices, parseMonths, sinceDate, type PurchaseLine } from "./price-compare";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const line = (vendorId: string, rate: number, quantity: number, date = "2026-09-01", description = "Cement OPC 53", unit = "BAG"): PurchaseLine => ({ description, unit, rate, quantity, vendorId, vendorName: `Vendor ${vendorId}`, invoiceDate: d(date) });

// ---- basic comparison: weighted averages, cheapest first, saving
const [cement] = comparePrices([
  line("A", 380, 100), // A: 100 bags at 380
  line("A", 400, 100), // A: average 390
  line("B", 420, 50), // B: 50 bags at 420
]);
assert.equal(cement.suppliers.length, 2);
assert.deepEqual(cement.suppliers.map((s) => s.vendorId), ["A", "B"], "cheapest first");
assert.equal(cement.cheapestId, "A");
assert.deepEqual([cement.suppliers[0].avgRate, cement.suppliers[0].quantity, cement.suppliers[0].spend, cement.suppliers[0].purchases], [390, 200, 78_000, 2]);
assert.deepEqual([cement.suppliers[1].avgRate, cement.suppliers[1].premiumPercent, cement.suppliers[1].extraPaid], [420, 7.69, 1500]);
assert.equal(cement.suppliers[0].premiumPercent, 0);
assert.equal(cement.suppliers[0].extraPaid, 0);
assert.equal(cement.potentialSaving, 1500);
assert.equal(cement.maxPremiumPercent, 7.69);
assert.equal(cement.suppliers[0].lastRate, 400);
assert.equal(cement.suppliers[0].lastDate, "2026-09-01");

// quantity weighting: a huge cheap order and a tiny dear one
const [weighted] = comparePrices([line("A", 100, 1000), line("A", 200, 10), line("B", 150, 10)], { includeSmall: true });
assert.equal(weighted.suppliers.find((s) => s.vendorId === "A")!.avgRate, 100.99);
assert.equal(weighted.cheapestId, "A");

// ---- only items bought from two or more suppliers
assert.deepEqual(comparePrices([line("A", 380, 10), line("A", 390, 10)]), [], "one supplier is nothing to compare");
assert.deepEqual(comparePrices([]), []);

// ---- the same item in different spellings is one item; a different unit is another
const spelled = comparePrices([line("A", 100, 10, "2026-09-01", "Cement OPC-53", "bag"), line("B", 120, 10, "2026-09-01", "CEMENT  OPC 53", "BAG")]);
assert.equal(spelled.length, 1);
assert.equal(comparePrices([line("A", 100, 10, "2026-09-01", "Cement", "BAG"), line("B", 150, 10, "2026-09-01", "Cement", "KG")]).length, 0, "bags and kilos are not comparable");

// ---- ignored lines
const messy = comparePrices([line("A", 100, 10), line("A", 0, 10), line("A", -50, 10), line("B", 130, 0), line("B", NaN, 5), line("B", 130, 10), line("C", 100, Infinity)]);
assert.equal(messy.length, 1);
assert.deepEqual(messy[0].suppliers.map((s) => [s.vendorId, s.avgRate]), [["A", 100], ["B", 130]], "zero, negative, empty and broken lines are left out");
assert.deepEqual(comparePrices([{ ...line("A", 5, 1), description: "", unit: "" }, { ...line("B", 9, 1), description: "", unit: "" }]), [], "no description, nothing to match");

// ---- tie: the one you buy more from is the cheapest
const tie = comparePrices([line("A", 100, 10), line("B", 100, 90), line("C", 150, 10)])[0];
assert.equal(tie.cheapestId, "B");
assert.deepEqual(tie.suppliers.map((s) => s.vendorId), ["B", "A", "C"]);
assert.equal(tie.suppliers.find((s) => s.vendorId === "A")!.extraPaid, 0, "same average means nothing extra paid");

// ---- small differences are left out unless asked for
const closeCall = [line("A", 100, 50), line("B", 103, 50)];
assert.deepEqual(comparePrices(closeCall), [], "3% is not worth acting on");
assert.equal(comparePrices(closeCall, { includeSmall: true }).length, 1);
assert.equal(comparePrices([line("A", 100, 50), line("B", 105, 50)]).length, 1, "exactly 5% counts");
assert.equal(comparePrices(closeCall, { minPremium: 2 }).length, 1);

// ---- three suppliers: savings add up; sorted by saving
const [cheap, dear] = [
  comparePrices([line("A", 100, 10, "2026-09-01", "Sand"), line("B", 120, 10, "2026-09-01", "Sand"), line("C", 150, 20, "2026-09-01", "Sand")])[0],
  null,
];
assert.deepEqual(cheap.suppliers.map((s) => [s.vendorId, s.premiumPercent, s.extraPaid]), [["A", 0, 0], ["B", 20, 200], ["C", 50, 1000]]);
assert.equal(cheap.potentialSaving, 1200);
assert.equal(dear, null);
const ordered = comparePrices([
  line("A", 100, 10, "2026-09-01", "Small item"), line("B", 200, 10, "2026-09-01", "Small item"), // saving 1,000
  line("A", 100, 1000, "2026-09-01", "Big item"), line("B", 110, 1000, "2026-09-01", "Big item"), // saving 10,000
]);
assert.deepEqual(ordered.map((i) => i.description), ["Big item", "Small item"], "biggest saving first");

// ---- last purchase
const last = comparePrices([line("A", 100, 5, "2026-01-05"), line("A", 90, 5, "2026-08-20"), line("A", 95, 5, "2026-03-01"), line("B", 130, 5, "2026-02-02")])[0];
assert.deepEqual([last.suppliers[0].lastRate, last.suppliers[0].lastDate], [90, "2026-08-20"], "the most recent purchase, not the last in the list");

// ---- periods
assert.equal(sinceDate("2026-10-23", 12), "2025-10-23");
assert.equal(sinceDate("2026-10-23", 3), "2026-07-23");
assert.equal(sinceDate("2026-03-31", 1), "2026-02-28", "clamped to the end of a short month");
assert.equal(sinceDate("2024-03-31", 1), "2024-02-29", "leap year");
assert.equal(sinceDate("2026-01-15", 2), "2025-11-15", "across a year end");
assert.equal(parseMonths("6"), 6);
assert.equal(parseMonths(24), 24);
assert.equal(parseMonths("7"), 12);
assert.equal(parseMonths(undefined), 12);
assert.equal(parseMonths("abc"), 12);

console.log("price compare: all checks passed");
