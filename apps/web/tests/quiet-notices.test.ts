// Database-backed tests of the check-in email to quiet companies: who gets it, once a month, and a failed send is retried.
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
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

async function main() {
  const { sendQuietNotices } = await import("@/lib/flows/quiet-notices");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  async function company(id: string, o: { created?: number; active?: number | null; status?: string; notice?: number | null }) {
    await q(
      `INSERT INTO "Organization"(id,name,slug,status,"createdAt","lastActiveAt","quietNoticeAt","updatedAt") VALUES ($1,$2,$1,$3::"OrgStatus",$4,$5,$6,now())`,
      [id, `Quiet ${id}`, o.status ?? "ACTIVE", ago(o.created ?? 200), o.active == null ? null : ago(o.active), o.notice == null ? null : ago(o.notice)],
    );
  }
  async function person(id: string, orgId: string, role: string, o: { verified?: boolean } = {}) {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',$4,now())`, [id, `${role} ${id}`, `${id}@qn.test`, o.verified === false ? null : new Date().toISOString()]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
  }

  await company("qn_busy", { active: 2 });
  await company("qn_quiet", { active: 20 });
  await company("qn_gone", { active: 200 });
  await company("qn_told", { active: 40, notice: 5 });
  await company("qn_old_notice", { active: 60, notice: 40 });
  await company("qn_susp", { active: 20, status: "SUSPENDED" });
  await company("qn_new", { created: 3, active: null });
  await company("qn_never", { created: 30, active: null, status: "TRIAL" });
  await company("qn_empty", { active: 20 });
  for (const c of ["busy", "quiet", "gone", "told", "old_notice", "susp", "new", "never"]) await person(`qn_admin_${c}`, `qn_${c}`, "ADMIN");
  await person("qn_staff_quiet", "qn_quiet", "STAFF");
  await person("qn_unverified_quiet", "qn_quiet", "ADMIN", { verified: false });
  await person("qn_unverified_empty", "qn_empty", "ADMIN", { verified: false });

  let first = { sent: 0, emails: 0, noRecipients: 0, failed: 0 };
  await check("a company quiet for two weeks writes to its verified administrators, and only them", async () => {
    first = await sendQuietNotices();
    const m = mailsTo("qn_admin_quiet@qn.test");
    assert.equal(m.length, 1);
    assert.match(m[0].subject, /we have not seen you/);
    assert.match(m[0].text, /20 days/);
    assert.match(m[0].text, /safe/);
    for (const none of ["qn_staff_quiet", "qn_unverified_quiet"]) assert.equal(mailsTo(`${none}@qn.test`).length, 0, none);
  });

  await check("busy, long-gone, recently told, suspended and brand-new companies are left alone", async () => {
    for (const c of ["busy", "gone", "told", "susp", "new"]) assert.equal(mailsTo(`qn_admin_${c}@qn.test`).length, 0, c);
  });

  await check("a company told over a month ago, and one never active (counted from sign-up), are written to", async () => {
    assert.equal(mailsTo("qn_admin_old_notice@qn.test").length, 1);
    assert.equal(mailsTo("qn_admin_never@qn.test").length, 1);
    assert.ok(first.sent >= 3);
  });

  await check("a company with nobody to write to gives the claim back and is counted", async () => {
    assert.ok(first.noRecipients >= 1);
    const [row] = await q<{ quietNoticeAt: Date | null }>(`SELECT "quietNoticeAt" FROM "Organization" WHERE id='qn_empty'`);
    assert.equal(row.quietNoticeAt, null);
  });

  await check("running again sends nothing more (once a month)", async () => {
    const before = mails().length;
    const again = await sendQuietNotices();
    assert.equal(again.sent, 0);
    assert.equal(mails().length, before);
  });

  await check("the notice is remembered, and two runs at once send one email", async () => {
    const [row] = await q<{ quietNoticeAt: Date | null }>(`SELECT "quietNoticeAt" FROM "Organization" WHERE id='qn_quiet'`);
    assert.ok(row.quietNoticeAt);
    await q(`UPDATE "Organization" SET "quietNoticeAt"=NULL WHERE id='qn_quiet'`);
    const before = mailsTo("qn_admin_quiet@qn.test").length;
    await Promise.all([sendQuietNotices(), sendQuietNotices()]);
    assert.equal(mailsTo("qn_admin_quiet@qn.test").length, before + 1);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
