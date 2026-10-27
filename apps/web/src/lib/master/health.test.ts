import assert from "node:assert/strict";
import { cleanText, dueTone, healthOf, parseDueDate, stageOf, todayUtc, trialDaysLeft, type Signals } from "./health";

const now = new Date("2026-11-10T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const ahead = (days: number) => new Date(now.getTime() + days * 86_400_000);
const base: Signals = { state: "trial", createdAt: ago(1), trialEndsAt: ahead(13), currentPeriodEnd: null, projects: 0, members: 1, lastActiveAt: ago(0), openTickets: 0, suspended: false, now };
const s = (over: Partial<Signals>): Signals => ({ ...base, ...over });
const texts = (x: Partial<Signals>) => healthOf(s(x)).reasons.map((r) => r.text);

// Stages
assert.equal(stageOf(s({ projects: 0 })), "signed_up");
assert.equal(stageOf(s({ projects: 1, lastActiveAt: ago(2) })), "using");
assert.equal(stageOf(s({ projects: 1, lastActiveAt: ago(7) })), "set_up", "seven full days quiet is no longer 'using'");
assert.equal(stageOf(s({ projects: 1, lastActiveAt: null })), "set_up");
for (const state of ["active", "past_due_grace", "past_due", "canceling"] as const) assert.equal(stageOf(s({ state, projects: 0 })), "paying", state);
for (const state of ["canceled", "trial_expired"] as const) assert.equal(stageOf(s({ state, projects: 3 })), "lost", state);

// Trial days left
assert.equal(trialDaysLeft(s({ trialEndsAt: ahead(2.2) })), 3);
assert.equal(trialDaysLeft(s({ trialEndsAt: ahead(0.1) })), 1);
assert.equal(trialDaysLeft(s({ trialEndsAt: ago(1) })), 0);
assert.equal(trialDaysLeft(s({ state: "active" })), null);
assert.equal(trialDaysLeft(s({ trialEndsAt: null })), null);

// A fresh sign-up with nothing yet is fine; the same company later is not
assert.equal(healthOf(s({})).level, "ok");
assert.deepEqual(texts({ createdAt: ago(5) }), ["No project after 5 days"]);
assert.deepEqual(texts({ createdAt: ago(2) }), []);
assert.deepEqual(texts({ createdAt: ago(10), projects: 1, lastActiveAt: ago(9) }), ["No activity for 9 days"]);
assert.deepEqual(texts({ createdAt: ago(10), projects: 1, lastActiveAt: null }), ["Set up but never used"]);
assert.deepEqual(texts({ createdAt: ago(10), projects: 1, lastActiveAt: ago(1) }), []);

// Trial ending soon is a risk, with the right words
assert.equal(healthOf(s({ trialEndsAt: ahead(2.5) })).level, "risk");
assert.deepEqual(texts({ trialEndsAt: ahead(2.5) }), ["Trial ends in 3 days"]);
assert.deepEqual(texts({ trialEndsAt: ahead(0.5) }), ["Trial ends in 1 day"]);
assert.deepEqual(texts({ trialEndsAt: ahead(4.5) }), [], "five days left is not yet a warning");
assert.deepEqual(texts({ trialEndsAt: ago(0.2) }), ["Trial ends today"]);

// Money problems
assert.equal(healthOf(s({ state: "past_due", projects: 1 })).level, "risk");
assert.equal(healthOf(s({ state: "past_due_grace", projects: 1 })).level, "risk");
assert.equal(healthOf(s({ state: "trial_expired", projects: 1 })).level, "risk");
assert.equal(healthOf(s({ state: "canceling", projects: 1 })).level, "watch");
assert.equal(healthOf(s({ state: "active", projects: 2, lastActiveAt: ago(1) })).level, "ok");

// Paying but gone quiet
assert.deepEqual(texts({ state: "active", projects: 2, lastActiveAt: ago(20) }), ["Paying but no activity for 20 days"]);
assert.deepEqual(texts({ state: "active", projects: 2, lastActiveAt: ago(10) }), [], "ten days quiet is normal for a paying company");

// Tickets and suspension
assert.deepEqual(texts({ state: "active", projects: 1, openTickets: 1 }), ["1 open support ticket"]);
assert.deepEqual(texts({ state: "active", projects: 1, openTickets: 3 }), ["3 open support tickets"]);
assert.equal(healthOf(s({ state: "active", projects: 1, openTickets: 1 })).level, "watch");
assert.ok(texts({ suspended: true }).includes("Suspended by an operator"));

// Several reasons at once keep every one and take the worst
const bad = healthOf(s({ createdAt: ago(20), projects: 1, lastActiveAt: ago(15), trialEndsAt: ahead(1), openTickets: 2 }));
assert.equal(bad.level, "risk");
assert.equal(bad.reasons.length, 3);

// Follow-up dates
const today = todayUtc(now);
assert.equal(today.toISOString(), "2026-11-10T00:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
assert.equal(dueTone(d("2026-11-09"), today), "overdue");
assert.equal(dueTone(d("2026-11-10"), today), "today");
assert.equal(dueTone(d("2026-11-13"), today), "soon");
assert.equal(dueTone(d("2026-11-14"), today), "later");
assert.ok(parseDueDate("2026-11-10", today).ok, "today is allowed");
assert.ok(parseDueDate(" 2027-01-05 ", today).ok);
for (const [raw, why] of [["2026-11-09", /past/], ["2028-01-01", /year/], ["2026-02-30", /exist/], ["10/11/2026", /Choose/], ["", /Choose/], [null, /Choose/], [20261110, /Choose/]] as const) {
  const r = parseDueDate(raw, today);
  assert.ok(!r.ok && why.test(r.error), `${String(raw)} -> ${JSON.stringify(r)}`);
}

// Text
assert.equal(cleanText("  hello \r\n world ", 50), "hello \n world");
assert.equal(cleanText("   ", 50), null);
assert.equal(cleanText("x".repeat(51), 50), null);
assert.equal(cleanText(5, 50), null);

console.log("client health: all checks passed");
