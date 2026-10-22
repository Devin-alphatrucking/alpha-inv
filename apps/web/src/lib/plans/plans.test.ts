// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import {
  allowsGrowth, blockedMessage, checkAddInvoices, checkAddProject, checkAddUsers, checkCompanyPageCap, checkPageLimit,
  computeLimits, parseOverrides, planState, ticketPriority, trialDaysLeft,
  type PlanInput, type SubscriptionInput,
} from "./rules";

const plan: PlanInput = { code: "PROJECT", name: "Project plan", includedProjects: 1, userLimit: 5, aiPagesPerProject: 500 };
const now = new Date("2026-10-24T12:00:00Z");
const day = 86_400_000;
const sub = (o: Partial<SubscriptionInput> = {}): SubscriptionInput => ({ status: "ACTIVE", quantity: 1, trialEndsAt: null, currentPeriodEnd: null, graceEndsAt: null, ...o });

// ---- state machine
assert.equal(planState(null, now), "none");
assert.equal(planState(sub(), now), "active");
assert.equal(planState(sub({ status: "TRIALING", trialEndsAt: new Date(+now + day) }), now), "trial");
assert.equal(planState(sub({ status: "TRIALING", trialEndsAt: new Date(+now - 1) }), now), "trial_expired");
assert.equal(planState(sub({ status: "TRIALING", trialEndsAt: null }), now), "trial_expired", "a trial with no end date is not open-ended");
assert.equal(planState(sub({ status: "PAST_DUE", graceEndsAt: new Date(+now + day) }), now), "past_due_grace");
assert.equal(planState(sub({ status: "PAST_DUE", graceEndsAt: new Date(+now - day) }), now), "past_due");
assert.equal(planState(sub({ status: "PAST_DUE" }), now), "past_due");
assert.equal(planState(sub({ status: "CANCELED", currentPeriodEnd: new Date(+now + day) }), now), "canceling");
assert.equal(planState(sub({ status: "CANCELED", currentPeriodEnd: new Date(+now - day) }), now), "canceled");
for (const s of ["trial", "active", "past_due_grace", "canceling"] as const) assert.equal(allowsGrowth(s), true, s);
for (const s of ["trial_expired", "past_due", "canceled", "none"] as const) {
  assert.equal(allowsGrowth(s), false, s);
  assert.ok(blockedMessage(s).length > 20, `${s} has a plain-language message`);
  assert.match(blockedMessage(s), /existing data|Existing data|plan yet/i);
}

// ---- limits: ONE plan = ONE project; buying again adds a project AND the plan's users
assert.deepEqual(computeLimits(plan, { quantity: 1, overrides: null }), { projects: 1, users: 5, aiPagesPerProject: 500, companyPageCap: 500 });
assert.deepEqual(computeLimits(plan, { quantity: 3, overrides: null }), { projects: 3, users: 15, aiPagesPerProject: 500, companyPageCap: 1500 });
assert.deepEqual(computeLimits(plan, { quantity: 0, overrides: null }), { projects: 0, users: 0, aiPagesPerProject: 500, companyPageCap: 0 });
assert.equal(computeLimits(plan, { quantity: 2.9, overrides: null }).projects, 2, "a fractional quantity rounds down");
const ov = computeLimits(plan, { quantity: 1, overrides: { extraProjects: 1, extraUsers: 3, aiPagesPerProject: 800 } });
assert.deepEqual(ov, { projects: 2, users: 8, aiPagesPerProject: 800, companyPageCap: 1600 });
assert.deepEqual(parseOverrides({ extraProjects: -5, extraUsers: "lots", aiPagesPerProject: NaN }), { extraProjects: 0, extraUsers: 0, aiPagesPerProject: null }, "bad overrides grant nothing");
assert.deepEqual(parseOverrides(null), { extraProjects: 0, extraUsers: 0, aiPagesPerProject: null });
assert.equal(parseOverrides({ extraProjects: 10 ** 9 }).extraProjects, 0, "absurd values are ignored");

// ---- adding projects
const l1 = computeLimits(plan, { quantity: 1, overrides: null });
assert.deepEqual(checkAddProject("active", l1, { projects: 0, users: 1, pendingInvites: 0 }), { ok: true });
const full = checkAddProject("active", l1, { projects: 1, users: 1, pendingInvites: 0 });
assert.ok(!full.ok && /includes 1 project and you already have 1/.test(full.message) && /another project plan/.test(full.message));
assert.deepEqual(checkAddProject("active", computeLimits(plan, { quantity: 2, overrides: null }), { projects: 1, users: 1, pendingInvites: 0 }), { ok: true }, "buying the plan again makes room");
assert.equal(checkAddProject("trial_expired", l1, { projects: 0, users: 0, pendingInvites: 0 }).ok, false, "an expired trial cannot add even within the limit");
assert.equal(checkAddProject("trial", l1, { projects: 0, users: 0, pendingInvites: 0 }).ok, true);

// ---- adding people: members + open invitations count
assert.equal(checkAddUsers("active", l1, { projects: 1, users: 4, pendingInvites: 0 }).ok, true);
assert.equal(checkAddUsers("active", l1, { projects: 1, users: 5, pendingInvites: 0 }).ok, false);
assert.equal(checkAddUsers("active", l1, { projects: 1, users: 3, pendingInvites: 2 }).ok, false, "pending invitations take seats");
assert.equal(checkAddUsers("active", l1, { projects: 1, users: 3, pendingInvites: 1 }).ok, true);
assert.equal(checkAddUsers("active", l1, { projects: 1, users: 3, pendingInvites: 0 }, 3).ok, false, "adding several at once");
const seatMsg = checkAddUsers("active", l1, { projects: 1, users: 4, pendingInvites: 1 });
assert.ok(!seatMsg.ok && /includes 5 users and 5 are already taken/.test(seatMsg.message) && /adds more users/.test(seatMsg.message));
assert.equal(checkAddUsers("past_due", l1, { projects: 1, users: 1, pendingInvites: 0 }).ok, false);
assert.equal(checkAddUsers("past_due_grace", l1, { projects: 1, users: 1, pendingInvites: 0 }).ok, true, "the grace period keeps everything working");

// ---- invoices and AI pages
assert.equal(checkAddInvoices("active").ok, true);
assert.equal(checkAddInvoices("canceled").ok, false);
assert.equal(checkPageLimit(500, l1).ok, true);
assert.equal(checkPageLimit(100, l1).ok, true, "lowering is always fine");
assert.equal(checkPageLimit(501, l1).ok, false, "a company admin cannot raise their own limit");
assert.equal(checkCompanyPageCap(1000, computeLimits(plan, { quantity: 2, overrides: null })).ok, true);
assert.equal(checkCompanyPageCap(1001, computeLimits(plan, { quantity: 2, overrides: null })).ok, false);

// ---- trial days and support priority
assert.equal(trialDaysLeft({ trialEndsAt: new Date(+now + 3 * day - 1000) }, now), 3);
assert.equal(trialDaysLeft({ trialEndsAt: new Date(+now - day) }, now), 0);
assert.equal(trialDaysLeft(null, now), null);
assert.equal(ticketPriority("active"), "HIGH");
assert.equal(ticketPriority("trial"), "NORMAL");
assert.equal(ticketPriority("canceled"), "NORMAL");

console.log("plans: all checks passed");
