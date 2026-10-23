// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { bucketFor, daysLate, summarise, type OwedInvoice } from "./ageing";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = "2026-10-23";
const inv = (id: string, total: number, paid: number, due: string | null): OwedInvoice => ({ id, invoiceNumber: `N-${id}`, vendorName: "V", projectName: "P", total, paid, dueDate: due ? d(due) : null });

// ---- days late
assert.equal(daysLate(d("2026-10-23"), today), 0, "due today");
assert.equal(daysLate(d("2026-10-22"), today), 1);
assert.equal(daysLate(d("2026-10-30"), today), -7);
assert.equal(daysLate(d("2026-09-23"), today), 30);
assert.equal(daysLate(null, today), null);
assert.equal(daysLate(new Date("garbage"), today), null);
assert.equal(daysLate(d("2025-12-31"), "2026-01-01"), 1, "across a year end");

// ---- buckets
assert.equal(bucketFor(-5), "current");
assert.equal(bucketFor(0), "current");
assert.equal(bucketFor(1), "d1_30");
assert.equal(bucketFor(30), "d1_30");
assert.equal(bucketFor(31), "d31_60");
assert.equal(bucketFor(60), "d31_60");
assert.equal(bucketFor(61), "d61_90");
assert.equal(bucketFor(90), "d61_90");
assert.equal(bucketFor(91), "d90");
assert.equal(bucketFor(null), "noDue");

// ---- summary
const list = [
  inv("a", 1000, 0, "2026-10-25"), // due in 2 days
  inv("b", 500, 100, "2026-10-23"), // due today, 400 left
  inv("c", 2000, 0, "2026-10-10"), // 13 late
  inv("d", 3000, 1000, "2026-08-01"), // 83 late, 2000 left
  inv("e", 700, 0, "2026-06-01"), // 144 late
  inv("f", 900, 900, "2026-09-01"), // fully paid: ignored
  inv("g", 300, 0, null), // no due date
  inv("h", 800, 0, "2026-11-30"), // far in the future
  inv("i", 100, 150, "2026-09-01"), // overpaid: ignored
];
const s = summarise(list, today);
const by = Object.fromEntries(s.buckets.map((b) => [b.key, b]));
assert.deepEqual([by.current.count, by.current.amountMinor], [3, 100000 + 40000 + 80000], "a, b and h are not late");
assert.deepEqual([by.d1_30.count, by.d1_30.amountMinor], [1, 200000]);
assert.deepEqual([by.d31_60.count, by.d31_60.amountMinor], [0, 0]);
assert.deepEqual([by.d61_90.count, by.d61_90.amountMinor], [1, 200000]);
assert.deepEqual([by.d90.count, by.d90.amountMinor], [1, 70000]);
assert.deepEqual([by.noDue.count, by.noDue.amountMinor], [1, 30000]);
assert.equal(s.owedMinor, 100000 + 40000 + 200000 + 200000 + 70000 + 30000 + 80000);
assert.equal(s.buckets.reduce((x, b) => x + b.amountMinor, 0), s.owedMinor, "the buckets add up to the total owed");

assert.equal(s.overdue.count, 3);
assert.equal(s.overdue.amountMinor, 200000 + 200000 + 70000);
assert.deepEqual(s.overdue.oldest.map((o) => o.id), ["e", "d", "c"], "oldest first");
assert.deepEqual(s.dueSoon.items.map((o) => o.id), ["b", "a"], "due today first, then the next days");
assert.equal(s.dueSoon.count, 2);
assert.equal(s.dueSoon.amountMinor, 140000);

// due-soon window and list size
assert.equal(summarise(list, today, 3).dueSoon.count, 2);
assert.equal(summarise(list, today, 1).dueSoon.count, 1, "only today");
assert.equal(summarise(list, today, 7, 2).overdue.oldest.length, 2);
assert.equal(summarise([], today).owedMinor, 0);
assert.equal(summarise([], today).overdue.count, 0);

// cents are exact
assert.equal(summarise([inv("x", 0.3, 0.1 + 0.2, "2026-01-01")], today).overdue.count, 0, "0.1 + 0.2 settles 0.3");
assert.equal(summarise([inv("y", 1234.56, 0, "2026-01-01")], today).owedMinor, 123456);

console.log("ageing: all checks passed");
