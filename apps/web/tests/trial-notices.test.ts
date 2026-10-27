// Database-backed tests of the trial emails: who gets them, that each goes out once, and that extending a trial starts again.
// Run through `npm run test:isolation`.
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

type Mail = { to: string; subject: string; text: string; html: string };
const mails = (): Mail[] => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail) : []);
const mailsTo = (email: string) => mails().filter((m) => m.to === email);

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

async function main() {
  const { sendTrialNotices } = await import("@/lib/flows/trial-notices");
  const ops = await import("@/lib/master/ops");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  async function company(id: string, o: { trialEnds: string; status?: string; orgStatus?: string }) {
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$1,$3::"OrgStatus",now())`, [id, `Trial ${id}`, o.orgStatus ?? "TRIAL"]);
    await q(`INSERT INTO "Subscription"(id,"organizationId","planId",quantity,status,"trialEndsAt","updatedAt") VALUES ($1,$2,'plan_project',1,$3::"SubscriptionStatus",$4,now())`, [`s_${id}`, id, o.status ?? "TRIALING", o.trialEnds]);
  }
  async function person(id: string, orgId: string, role: string, o: { verified?: boolean; deleted?: boolean } = {}) {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","deletedAt","updatedAt") VALUES ($1,$2,$3,'x',$4,$5,now())`, [id, `${role} ${id}`, `${id}@tn.test`, o.verified === false ? null : new Date().toISOString(), o.deleted ? new Date().toISOString() : null]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
  }

  const operator = { id: "u_tn_op", email: "tn-operator@platform.test", name: "Operator", twoStep: true };
  await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","isPlatformAdmin","updatedAt") VALUES ($1,'Operator',$2,'x',now(),true,now())`, [operator.id, operator.email]);

  await company("tn_far", { trialEnds: at(10) });
  await company("tn_soon", { trialEnds: at(2.5) });
  await company("tn_over", { trialEnds: at(-1) });
  await company("tn_old", { trialEnds: at(-30) });
  await company("tn_paid", { trialEnds: at(1), status: "ACTIVE" });
  await company("tn_susp", { trialEnds: at(1), orgStatus: "SUSPENDED" });
  await company("tn_empty", { trialEnds: at(1) });
  for (const c of ["far", "soon", "over", "old", "paid", "susp"]) {
    await person(`tn_admin_${c}`, `tn_${c}`, "ADMIN");
  }
  await person("tn_admin_soon2", "tn_soon", "ADMIN");
  await person("tn_staff_soon", "tn_soon", "STAFF");
  await person("tn_unverified_soon", "tn_soon", "ADMIN", { verified: false });
  await person("tn_deleted_soon", "tn_soon", "ADMIN", { deleted: true });
  await person("tn_unverified_empty", "tn_empty", "ADMIN", { verified: false });

  let first = { ending: 0, ended: 0, emails: 0, noRecipients: 0, failed: 0, checked: 0 };
  await check("a trial with three days or less left tells its verified administrators, and only them", async () => {
    first = await sendTrialNotices();
    assert.deepEqual(mailsTo("tn_admin_soon@tn.test").map((m) => m.subject), ["Trial tn_soon: your trial ends in 3 days"]);
    assert.equal(mailsTo("tn_admin_soon2@tn.test").length, 1);
    for (const none of ["tn_staff_soon", "tn_unverified_soon", "tn_deleted_soon"]) assert.equal(mailsTo(`${none}@tn.test`).length, 0, none);
    const m = mailsTo("tn_admin_soon@tn.test")[0];
    assert.match(m.text, /Nothing is deleted/);
    assert.match(m.html, /Choose a plan/);
  });

  await check("a trial that has just ended is told once; far-off, long-gone, paid and suspended companies are left alone", () => {
    assert.deepEqual(mailsTo("tn_admin_over@tn.test").map((m) => m.subject), ["Trial tn_over: your trial has ended"]);
    for (const c of ["far", "old", "paid", "susp"]) assert.equal(mailsTo(`tn_admin_${c}@tn.test`).length, 0, c);
    assert.equal(first.ending >= 1 && first.ended >= 1, true);
  });

  await check("a company with nobody to tell is not marked as told, so it is tried again later", async () => {
    assert.ok(first.noRecipients >= 1);
    const [s] = await q<{ trialEndingNoticeAt: Date | null }>(`SELECT "trialEndingNoticeAt" FROM "Subscription" WHERE "organizationId"='tn_empty'`);
    assert.equal(s.trialEndingNoticeAt, null);
    await person("tn_admin_empty_late", "tn_empty", "ADMIN");
    await sendTrialNotices();
    assert.equal(mailsTo("tn_admin_empty_late@tn.test").length, 1, "told once an administrator exists");
  });

  await check("running again, even many times at once, sends nothing more", async () => {
    const before = mails().length;
    await Promise.all(Array.from({ length: 5 }, () => sendTrialNotices()));
    assert.equal(mails().length, before);
    const [s] = await q<{ trialEndingNoticeAt: Date | null }>(`SELECT "trialEndingNoticeAt" FROM "Subscription" WHERE "organizationId"='tn_soon'`);
    assert.ok(s.trialEndingNoticeAt);
  });

  await check("five runs at the same moment on a fresh company still send one email", async () => {
    await company("tn_race", { trialEnds: at(2) });
    await person("tn_admin_race", "tn_race", "ADMIN");
    await Promise.all(Array.from({ length: 5 }, () => sendTrialNotices()));
    assert.equal(mailsTo("tn_admin_race@tn.test").length, 1);
  });

  await check("when the trial ends the 'ended' notice follows, once, even though 'ending' was sent before", async () => {
    // pretend three days have passed for tn_soon
    const later = new Date(Date.now() + 3 * DAY);
    const run = await sendTrialNotices({ now: later });
    assert.ok(run.ended >= 1);
    assert.deepEqual(mailsTo("tn_admin_soon@tn.test").map((m) => m.subject), ["Trial tn_soon: your trial ends in 3 days", "Trial tn_soon: your trial has ended"]);
    const before = mails().length;
    await sendTrialNotices({ now: later });
    assert.equal(mails().length, before);
  });

  await check("extending a trial clears the marks, so the new end date is announced again", async () => {
    await ops.extendTrial(operator, "tn_over", 2, "Customer asked for more time");
    const [s] = await q<{ trialEndingNoticeAt: Date | null; trialEndedNoticeAt: Date | null }>(`SELECT "trialEndingNoticeAt","trialEndedNoticeAt" FROM "Subscription" WHERE "organizationId"='tn_over'`);
    assert.deepEqual([s.trialEndingNoticeAt, s.trialEndedNoticeAt], [null, null]);
    await sendTrialNotices();
    assert.deepEqual(mailsTo("tn_admin_over@tn.test").map((m) => m.subject), ["Trial tn_over: your trial has ended", "Trial tn_over: your trial ends in 2 days"]);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
