// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { budgetAlerts, budgetStatus, parseBudgetInput } from "./budget";

// ---- status levels
let s = budgetStatus(0, 1000);
assert.deepEqual([s.level, s.percent, s.remainingMinor, s.overMinor], ["ok", 0, 100000, 0]);
s = budgetStatus(799.99, 1000);
assert.equal(s.level, "ok", "just under 80%");
s = budgetStatus(800, 1000);
assert.deepEqual([s.level, s.percent], ["warn", 80], "exactly 80% is a warning");
s = budgetStatus(999.99, 1000);
assert.equal(s.level, "warn");
s = budgetStatus(1000, 1000);
assert.deepEqual([s.level, s.percent, s.remainingMinor, s.overMinor], ["over", 100, 0, 0], "exactly 100% is over (the budget is used up)");
s = budgetStatus(1250.5, 1000);
assert.deepEqual([s.level, s.percent, s.remainingMinor, s.overMinor], ["over", 125.1, 0, 25050]);

// ---- no budget
for (const none of [null, undefined, 0, -5, NaN, Infinity]) {
  const n = budgetStatus(500, none as number | null);
  assert.deepEqual([n.level, n.percent, n.budgetMinor, n.remainingMinor], ["none", null, null, null], String(none));
}
assert.equal(budgetStatus(-10, 1000).spentMinor, 0, "negative spend counts as nothing");

// ---- cents are exact
assert.equal(budgetStatus(0.1 + 0.2, 0.3).level, "over", "0.1 + 0.2 uses up a 0.30 budget");
assert.equal(budgetStatus(79.99, 100).level, "ok");
assert.equal(budgetStatus(80, 100).level, "warn");

// ---- alerts
const alerts = budgetAlerts([
  { id: "a", name: "A", spent: 100, budget: 1000 }, // 10%: no alert
  { id: "b", name: "B", spent: 850, budget: 1000 }, // 85%
  { id: "c", name: "C", spent: 1500, budget: 1000 }, // 150%
  { id: "d", name: "D", spent: 900, budget: 1000 }, // 90%
  { id: "e", name: "E", spent: 5000, budget: null }, // no budget
  { id: "f", name: "F", spent: 1000, budget: 1000 }, // 100%
]);
assert.deepEqual(alerts.map((a) => a.projectId), ["c", "f", "d", "b"], "over first (furthest over first), then warnings (closest to the limit first)");
assert.deepEqual(alerts.map((a) => a.level), ["over", "over", "warn", "warn"]);
assert.equal(budgetAlerts([]).length, 0);

// ---- the form box
assert.deepEqual(parseBudgetInput(""), { ok: true, value: null });
assert.deepEqual(parseBudgetInput("   "), { ok: true, value: null });
assert.deepEqual(parseBudgetInput(null), { ok: true, value: null });
assert.deepEqual(parseBudgetInput("0"), { ok: true, value: null }, "0 means no budget");
assert.deepEqual(parseBudgetInput("2500000"), { ok: true, value: 2500000 });
assert.deepEqual(parseBudgetInput("25,00,000.50"), { ok: true, value: 2500000.5 }, "commas are fine");
for (const bad of ["abc", "12.345", "-5", "1e6", "12 000", "$500", "999999999999"]) {
  assert.equal(parseBudgetInput(bad).ok, false, bad);
}

console.log("budget: all checks passed");
