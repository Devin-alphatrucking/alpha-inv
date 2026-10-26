// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { cashFlow, checkRun, MAX_RUN_ITEMS, owedList, parsePayAmount, presetIds, runTotalMinor, WEEKS_SHOWN } from "./planner";
import type { OwedInvoice } from "./ageing";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = "2026-10-23";
let n = 0;
const inv = (due: string | null, total: number, paid = 0, id = `i${++n}`): OwedInvoice => ({ id, invoiceNumber: `N-${id}`, vendorName: "V", projectName: "P", total, paid, dueDate: due ? d(due) : null });

// ---- owed list: only what is still owed, soonest first
const list = owedList(
  [
    inv("2026-11-20", 500, 0, "later"),
    inv("2026-10-01", 100, 0, "old"),
    inv(null, 900, 0, "nodue"),
    inv("2026-10-20", 300, 0, "recent"),
    inv("2026-10-01", 700, 0, "old-big"),
    inv("2026-10-25", 200, 200, "settled"),
    inv("2026-10-23", 50, 0, "today"),
  ],
  today,
);
assert.deepEqual(list.map((o) => o.id), ["old-big", "old", "recent", "today", "later", "nodue"], "settled left out; most overdue first, bigger first on a tie, no due date last");
assert.equal(list[0].balanceMinor, 70_000);
assert.equal(list[0].daysLate, 22);
assert.equal(list.find((o) => o.id === "today")!.daysLate, 0);

// ---- cash flow by week
const flow = cashFlow(
  owedList(
    [
      inv("2026-10-01", 100), // overdue
      inv("2026-10-22", 200), // overdue by a day
      inv("2026-10-23", 300), // today: this week
      inv("2026-10-29", 400), // day 6: still this week
      inv("2026-10-30", 500), // day 7: next week
      inv("2026-11-05", 600), // day 13: next week
      inv("2026-11-06", 700), // day 14: in 2 weeks
      inv("2026-12-18", 800), // day 56: later (8 weeks = days 0-55)
      inv("2026-12-17", 900), // day 55: in 7 weeks
      inv(null, 1000),
    ],
    today,
  ),
);
const amount = (key: string) => flow.find((w) => w.key === key)!.amountMinor / 100;
assert.equal(flow.length, 1 + WEEKS_SHOWN + 2);
assert.equal(amount("overdue"), 300);
assert.equal(amount("w0"), 700);
assert.equal(amount("w1"), 1100);
assert.equal(amount("w2"), 700);
assert.equal(amount("w7"), 900);
assert.equal(amount("later"), 800);
assert.equal(amount("none"), 1000);
assert.equal(flow[0].label, "Overdue");
assert.equal(flow[1].label, "This week");
assert.equal(flow[2].label, "Next week");
assert.equal(flow[3].label, "In 2 weeks");
assert.equal(flow.reduce((s, w) => s + w.amountMinor, 0) / 100, 100 + 200 + 300 + 400 + 500 + 600 + 700 + 800 + 900 + 1000, "every rupee is in exactly one bucket");
assert.equal(flow.reduce((s, w) => s + w.count, 0), 10);
assert.deepEqual(cashFlow([]).map((w) => w.count), new Array(1 + WEEKS_SHOWN + 2).fill(0));

// ---- quick picks
const owed = owedList([inv("2026-10-01", 1, 0, "late"), inv("2026-10-23", 1, 0, "today"), inv("2026-10-29", 1, 0, "d6"), inv("2026-10-30", 1, 0, "d7"), inv("2026-11-05", 1, 0, "d13"), inv("2026-11-06", 1, 0, "d14"), inv(null, 1, 0, "none")], today);
assert.deepEqual(presetIds(owed, "overdue"), ["late"]);
assert.deepEqual(presetIds(owed, "week"), ["late", "today", "d6"], "overdue plus the next 7 days (today and 6 more)");
assert.deepEqual(presetIds(owed, "fortnight"), ["late", "today", "d6", "d7", "d13"]);
assert.equal(presetIds(owed, "all").length, 7, "everything, including no due date");
assert.deepEqual(presetIds(owed, "none"), []);

// ---- typed amounts
const ok = (raw: unknown, bal: number) => {
  const r = parsePayAmount(raw, bal);
  assert.ok(r.ok, JSON.stringify(r));
  return r.minor;
};
const bad = (raw: unknown, bal: number) => {
  const r = parsePayAmount(raw, bal);
  assert.ok(!r.ok);
  return r.error;
};
assert.equal(ok("1250", 200_000), 125_000);
assert.equal(ok("1,250.50", 200_000), 125_050);
assert.equal(ok("0.10", 10), 10);
assert.equal(ok(" 2000 ", 200_000), 200_000, "the whole balance is allowed");
assert.match(bad("2000.01", 200_000), /more than the balance/);
assert.match(bad("0", 200_000), /more than zero/);
assert.match(bad("0.00", 200_000), /more than zero/);
assert.match(bad("-5", 200_000), /Enter an amount/);
assert.match(bad("12.345", 200_000), /Enter an amount/);
assert.match(bad("abc", 200_000), /Enter an amount/);
assert.match(bad("", 200_000), /Enter an amount/);
assert.match(bad(null, 200_000), /Enter an amount/);

// ---- checking a run
const run = (over: Record<string, unknown> = {}) => checkRun({ items: [{ invoiceId: "a", amount: 100 }, { invoiceId: "b", amount: 50.5 }], paidOn: today, mode: "UPI", reference: "BATCH-1", ...over }, today);
const good = run();
assert.ok(good.ok);
if (good.ok) {
  assert.deepEqual(good.run.items, [{ invoiceId: "a", amount: 100 }, { invoiceId: "b", amount: 50.5 }]);
  assert.deepEqual([good.run.paidOn, good.run.mode, good.run.reference], [today, "UPI", "BATCH-1"]);
}
const err = (r: ReturnType<typeof run>) => (r.ok ? "" : r.error);
assert.match(err(run({ items: [] })), /at least one/);
assert.match(err(run({ items: undefined })), /at least one/);
assert.match(err(checkRun(null, today)), /at least one/);
assert.match(err(run({ items: [{ invoiceId: "a", amount: 1 }, { invoiceId: "a", amount: 2 }] })), /twice/);
assert.match(err(run({ items: [{ invoiceId: "", amount: 1 }] })), /missing/);
assert.match(err(run({ items: [{ invoiceId: "a", amount: 0 }] })), /more than zero/);
assert.match(err(run({ items: [{ invoiceId: "a", amount: -3 }] })), /more than zero/);
assert.match(err(run({ items: [{ invoiceId: "a", amount: NaN }] })), /more than zero/);
assert.match(err(run({ items: [{ invoiceId: "a", amount: 0.001 }] })), /more than zero/, "less than a paisa is nothing");
assert.match(err(run({ paidOn: "" })), /date/);
assert.match(err(run({ paidOn: "2026-02-30" })), /date/);
assert.match(err(run({ paidOn: "23/10/2026" })), /date/);
assert.match(err(run({ paidOn: "2026-10-24" })), /future/);
assert.ok(run({ paidOn: "2026-01-05" }).ok, "a past date is fine");
assert.match(err(run({ mode: "x".repeat(51) })), /mode/);
assert.match(err(run({ reference: "x".repeat(101) })), /reference/);
assert.ok(run({ mode: undefined, reference: undefined }).ok);
const many = Array.from({ length: MAX_RUN_ITEMS + 1 }, (_, k) => ({ invoiceId: `i${k}`, amount: 1 }));
assert.match(err(run({ items: many })), /up to 100/);
assert.ok(run({ items: many.slice(0, MAX_RUN_ITEMS) }).ok);
const rounded = checkRun({ items: [{ invoiceId: "a", amount: 10.005 }], paidOn: today }, today);
assert.ok(rounded.ok);

// ---- totals
assert.equal(runTotalMinor([{ amount: 0.1 }, { amount: 0.2 }]), 30, "no floating point drift");
assert.equal(runTotalMinor([]), 0);

console.log("planner: all checks passed");
