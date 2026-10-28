// Database-backed tests of the paywall (data locked after the trial or an unpaid plan). Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const emailFile = process.env.EMAIL_FILE;
if (!ownerUrl || !emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 8).join("\n      ")}`);
  }
}
async function rejects(promise: Promise<unknown>) {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, "expected the call to fail, but it succeeded");
  return error as Error & { code?: string; status?: number };
}

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 160;
const ip = () => `198.51.100.${++ipCounter}`;
const day = 86_400_000;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const lock = await import("@/lib/plans/lock");
  const m = await import("@/lib/mobile/sessions");
  const http = await import("@/lib/mobile/http");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const email = "admin@lock-test.test";
  assert.ok((await signUp({ companyName: "Lock Test Co", name: "Lock Admin", email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
  const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
  assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
  const [{ id: orgId }] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" mm ON mm."organizationId"=o.id JOIN "User" u ON u.id=mm."userId" WHERE u.email=$1`, [email]);

  const setSub = async (sets: string) => {
    await q(`UPDATE "Subscription" SET ${sets} WHERE "organizationId"=$1`, [orgId]);
    lock.clearLockCache(orgId);
  };
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
  const state = async () => lock.companyLock(orgId);

  // ---------------------------------------------------------- which states lock
  await check("a running trial, an active plan, a payment inside its grace period and a plan ending later are all OPEN", async () => {
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(5)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [false, "trial"]);
    await setSub(`status='ACTIVE', quantity=1`);
    assert.deepEqual([(await state()).locked, (await state()).state], [false, "active"]);
    await setSub(`status='PAST_DUE', "graceEndsAt"='${iso(3)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [false, "past_due_grace"]);
    await setSub(`status='CANCELED', "currentPeriodEnd"='${iso(10)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [false, "canceling"]);
    await lock.assertNotLocked(orgId);
  });

  await check("an ended trial, an unpaid plan past its grace period, a finished cancellation and no plan are all LOCKED", async () => {
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(-1)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [true, "trial_expired"]);
    await setSub(`status='PAST_DUE', "graceEndsAt"='${iso(-1)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [true, "past_due"]);
    await setSub(`status='CANCELED', "currentPeriodEnd"='${iso(-1)}'`);
    assert.deepEqual([(await state()).locked, (await state()).state], [true, "canceled"]);
    const sub = (await q<{ id: string }>(`SELECT id FROM "Subscription" WHERE "organizationId"=$1`, [orgId]))[0];
    await q(`DELETE FROM "Subscription" WHERE id=$1`, [sub.id]);
    lock.clearLockCache(orgId);
    assert.deepEqual([(await state()).locked, (await state()).state], [true, "none"]);
    // put a trial back for the next tests
    await q(`INSERT INTO "Subscription"(id,"organizationId","planId",quantity,status,"trialEndsAt","updatedAt") SELECT 'sub_lock_test',$1,id,1,'TRIALING','${iso(-2)}',now() FROM "Plan" WHERE code='PROJECT'`, [orgId]);
    lock.clearLockCache(orgId);
  });

  await check("assertNotLocked refuses with a 402 and a plain message that says the data is safe", async () => {
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(-1)}'`);
    const e = await rejects(lock.assertNotLocked(orgId));
    assert.equal(e.code, "PLAN_LOCKED");
    assert.equal(e.status, 402);
    assert.match(e.message, /free trial has ended/i);
    assert.match(e.message, /data is safe/i);
    for (const s of ["trial_expired", "past_due", "canceled", "none"] as const) assert.match(lock.lockedMessage(s), /safe|plan/i);
  });

  await check("an operator extending the trial (or a payment arriving) opens the company again as soon as the cache is cleared", async () => {
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(-1)}'`);
    assert.equal((await state()).locked, true);
    // the database changes, but a cached answer may be up to 10 seconds old...
    await q(`UPDATE "Subscription" SET "trialEndsAt"='${iso(7)}' WHERE "organizationId"=$1`, [orgId]);
    assert.equal((await state()).locked, true, "the cached answer is still the old one");
    lock.clearLockCache(orgId);
    assert.equal((await state()).locked, false, "after clearing, the new state shows at once");
  });

  await check("isolation: one company's lock never affects another company", async () => {
    const other = "admin@lock-other.test";
    assert.ok((await signUp({ companyName: "Lock Other Co", name: "Other", email: other, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const f2 = mails().filter((x) => x.to === other && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(f2[f2.length - 1].text)![1])).ok);
    const [{ id: otherOrg }] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" mm ON mm."organizationId"=o.id JOIN "User" u ON u.id=mm."userId" WHERE u.email=$1`, [other]);
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(-1)}'`);
    assert.equal((await lock.companyLock(orgId)).locked, true);
    assert.equal((await lock.companyLock(otherOrg)).locked, false);
  });

  // ---------------------------------------------------------- mobile
  await check("mobile: a locked company can still sign in and ask /me, but every data call is refused with 402 until a plan is active", async () => {
    await setSub(`status='TRIALING', "trialEndsAt"='${iso(-1)}'`);
    await q(`DELETE FROM "RateLimit"`);
    const r = await m.loginMobile({ email, password: PW, platform: "android" }, { ip: ip() });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const req = new Request("http://app.test/api/v1/invoices", { headers: { authorization: `Bearer ${r.tokens.accessToken}` } });
    const me = await http.requireMobile(req, { allowLocked: true });
    assert.equal(me.orgId, orgId, "/me style calls work");
    const e = await rejects(http.requireMobile(req));
    assert.equal(e.code, "PLAN_LOCKED");
    assert.equal(e.status, 402);
    // paying (the operator or a webhook changes the plan) opens it again
    await setSub(`status='ACTIVE', quantity=1`);
    assert.equal((await http.requireMobile(req)).orgId, orgId);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
