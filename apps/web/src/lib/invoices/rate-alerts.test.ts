// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { baselinesFrom, buildBaseline, deviationPercent, lineKey, median, normaliseDescription, rateAlert, storedDeviation, MAX_SAMPLES, type RateSample } from "./rate-alerts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const sample = (rate: number, date = "2026-09-01", vendorName = "V"): RateSample => ({ rate, invoiceDate: d(date), vendorName });

// ---- normalising
assert.equal(normaliseDescription("Cement  OPC-53 (50kg)"), "CEMENT OPC 53 50KG");
assert.equal(normaliseDescription("  steel  "), "STEEL");
assert.equal(lineKey("Cement OPC-53", "bag"), lineKey("CEMENT OPC 53", "BAG"));
assert.notEqual(lineKey("Cement", "BAG"), lineKey("Cement", "KG"), "a different unit is a different item");

// ---- median
assert.equal(median([5]), 5);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 10]), 2.5);

// ---- baseline needs enough history
assert.equal(buildBaseline([]), null);
assert.equal(buildBaseline([sample(100), sample(110)]), null, "two purchases are not enough");
const b = buildBaseline([sample(100, "2026-06-01"), sample(120, "2026-07-01", "RAVI"), sample(110, "2026-09-10", "SHREE")])!;
assert.deepEqual([b.usual, b.count, b.lastRate, b.lastDate, b.lastVendor], [110, 3, 110, "2026-09-10", "SHREE"]);
assert.equal(buildBaseline([sample(100), sample(0), sample(-50), sample(NaN), sample(100)]), null, "zero, negative and broken rates do not count");
assert.equal(buildBaseline([sample(100), sample(100), sample(100), sample(0)])!.count, 3);

// one odd price does not drag the usual rate (median, not average)
assert.equal(buildBaseline([sample(100), sample(100), sample(100), sample(5000)])!.usual, 100);

// only the latest purchases count
const many: RateSample[] = [];
for (let i = 0; i < 30; i++) many.push(sample(i < 10 ? 50 : 200, `2026-${String(1 + Math.floor(i / 10)).padStart(2, "0")}-${String(1 + (i % 10)).padStart(2, "0")}`));
// 10 oldest are 50 (January), the newer 20 are 200: the usual is 200
const windowed = buildBaseline(many)!;
assert.equal(windowed.count, MAX_SAMPLES);
assert.equal(windowed.usual, 200);

// ---- deviation and alerts
const base = buildBaseline([sample(100), sample(100), sample(100)])!;
assert.equal(deviationPercent(115, base), 15);
assert.equal(deviationPercent(100, base), 0);
assert.equal(deviationPercent(0, base), null);
assert.equal(deviationPercent(-5, base), null);
assert.equal(deviationPercent(NaN, base), null);
assert.equal(deviationPercent(100, null), null);
assert.equal(deviationPercent(100, { usual: 0 }), null);

assert.equal(rateAlert(100, base), null);
assert.equal(rateAlert(114.99, base), null, "just under 15% is fine");
assert.deepEqual(rateAlert(115, base), { level: "high", percent: 15, usual: 100 });
assert.equal(rateAlert(129.99, base)!.level, "high");
assert.deepEqual(rateAlert(130, base), { level: "very-high", percent: 30, usual: 100 });
assert.equal(rateAlert(500, base)!.level, "very-high");
assert.equal(rateAlert(80, base), null, "cheaper is fine up to 30% below");
assert.equal(rateAlert(71, base), null);
assert.deepEqual(rateAlert(70, base), { level: "low", percent: -30, usual: 100 });
assert.equal(rateAlert(1, base)!.level, "low");
assert.equal(rateAlert(500, null), null, "no history, no alert");
assert.equal(rateAlert(0, base), null, "a blank rate is not an alert");
// float noise at the edge: 0.1-style numbers
assert.equal(rateAlert(1.15, buildBaseline([sample(1), sample(1), sample(1)]))!.level, "high");

// ---- stored value
assert.equal(storedDeviation(150, base), 50);
assert.equal(storedDeviation(50, base), -50);
assert.equal(storedDeviation(150, null), null);
assert.equal(storedDeviation(1_000_000, base), 9999, "kept inside the column's range");

// ---- grouping history into baselines
const map = baselinesFrom([
  ...[100, 102, 98].map((rate, i) => ({ description: "Cement OPC 53", unit: "Bag", rate, invoiceDate: d(`2026-0${i + 1}-01`), vendorName: "A" })),
  ...[500, 510].map((rate, i) => ({ description: "Steel TMT", unit: "KG", rate, invoiceDate: d(`2026-0${i + 1}-01`), vendorName: "B" })),
  ...[10, 11, 12].map((rate, i) => ({ description: "Cement OPC 53", unit: "KG", rate, invoiceDate: d(`2026-0${i + 1}-01`), vendorName: "A" })),
]);
assert.equal(map.size, 2, "steel has too little history");
assert.equal(map.get(lineKey("CEMENT OPC-53", "BAG"))!.usual, 100);
assert.equal(map.get(lineKey("CEMENT OPC-53", "KG"))!.usual, 11);
assert.equal(map.has(lineKey("Steel TMT", "KG")), false);

console.log("rate alerts: all checks passed");
