// Database-backed tests of the master console's account tools: set a company up by hand, reset a person's two-step
// sign-in, export one company's data. Run through `npm run test:isolation`.
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
async function rejects(promise: Promise<unknown>, match?: RegExp) {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, "expected the call to fail, but it succeeded");
  if (match) assert.match(String((error as Error).message), match);
  return error as Error;
}

type Mail = { to: string; subject: string; text: string; html: string };
const mails = (): Mail[] => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail) : []);
let ipCounter = 10;
const ip = () => `198.51.100.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail, resetPassword } = await import("@/lib/flows/verify-reset");
  const { createCompanyByHand, resetTwoStep } = await import("@/lib/master/setup-ops");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { loadCompanyData, parseDataset, exportResponse } = await import("@/lib/export/company-data");
  const { getEntitlements } = await import("@/lib/plans/entitlements");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const operator = { id: "u_operator_1", email: "operator@platform.test", name: "Operator", twoStep: true };
  await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","isPlatformAdmin","updatedAt") VALUES ($1,'Operator',$2,'x',now(),true,now())`, [operator.id, operator.email]);

  const goodInput = { companyName: "Hand Made Builders", country: "IN", adminName: "Asha Rao", adminEmail: "asha@handmade.test", mode: "trial", days: 21, quantity: 1 };

  await check("a company set up by hand on a trial has its administrator, plan, starter data and an emailed link", async () => {
    const r = await createCompanyByHand(operator, goodInput, "Partner deal agreed by email");
    assert.equal(r.emailed, true);
    const [org] = await q<{ id: string; name: string; status: string; country: string; currency: string; timezone: string }>(`SELECT id,name,status,country,currency,"timezone" FROM "Organization" WHERE id=$1`, [r.orgId]);
    assert.deepEqual([org.name, org.status, org.country, org.currency, org.timezone], ["Hand Made Builders", "TRIAL", "IN", "INR", "Asia/Kolkata"]);
    const [user] = await q<{ id: string; role: string; emailVerifiedAt: Date | null; termsAcceptedAt: Date | null }>(`SELECT id, role, "emailVerifiedAt", "termsAcceptedAt" FROM "User" WHERE email='asha@handmade.test'`);
    assert.equal(user.role, "ADMIN");
    assert.equal(user.emailVerifiedAt, null, "not verified until they use the link");
    assert.equal(user.termsAcceptedAt, null, "they have not accepted the terms yet");
    const [member] = await q<{ role: string }>(`SELECT role FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2`, [user.id, r.orgId]);
    assert.equal(member.role, "ADMIN");
    const [sub] = await q<{ status: string; quantity: number; trialEndsAt: Date; provider: string }>(`SELECT status, quantity, "trialEndsAt", provider FROM "Subscription" WHERE "organizationId"=$1`, [r.orgId]);
    assert.deepEqual([sub.status, sub.quantity, sub.provider], ["TRIALING", 1, "manual"]);
    const days = Math.round((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    assert.ok(days >= 20 && days <= 21, `trial length ${days}`);
    assert.ok(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Category" WHERE "organizationId"=$1`, [r.orgId]))[0].n) > 0, "starter categories");
    assert.equal((await q(`SELECT 1 FROM "Project" WHERE "organizationId"=$1`, [r.orgId])).length, 1, "a first project");
    assert.equal((await q(`SELECT 1 FROM "ProjectAssignment" WHERE "organizationId"=$1 AND "userId"=$2`, [r.orgId, user.id])).length, 1);
    const mail = mails().filter((m) => m.to === "asha@handmade.test" && /is ready/.test(m.subject)).at(-1);
    assert.ok(mail, "the welcome email was sent");
    assert.match(mail.text, /Hand Made Builders/);
    assert.match(mail.text, /reset-password\?token=/);
    assert.ok(!mail.text.includes(PW));
  });

  await check("the emailed link lets the administrator choose a password, which also confirms their address", async () => {
    const mail = mails().filter((m) => m.to === "asha@handmade.test" && /is ready/.test(m.subject)).at(-1)!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const [tokenRow] = await q<{ expiresAt: Date }>(`SELECT "expiresAt" FROM "AuthToken" WHERE email='asha@handmade.test' AND type='PASSWORD_RESET' AND "usedAt" IS NULL AND "revokedAt" IS NULL`);
    assert.ok(tokenRow.expiresAt.getTime() - Date.now() > 6 * 86_400_000, "the link lasts about a week, not an hour");
    const done = await resetPassword({ token, password: "A much better passphrase 2026" });
    assert.ok(done.ok, JSON.stringify(done));
    const [user] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='asha@handmade.test'`);
    assert.ok(user.emailVerifiedAt, "verified by using the link");
    assert.equal((await resetPassword({ token, password: "Another passphrase 2026 again" })).ok, false, "a link works once");
  });

  await check("a plan managed by hand is active with the number of project plans asked for, and nobody can know the starting password", async () => {
    const r = await createCompanyByHand(operator, { ...goodInput, companyName: "Managed Partner Co", adminEmail: "boss@managed.test", mode: "managed", quantity: 3 }, "Reseller contract");
    const [org] = await q<{ status: string }>(`SELECT status FROM "Organization" WHERE id=$1`, [r.orgId]);
    const [sub] = await q<{ status: string; quantity: number; trialEndsAt: Date | null }>(`SELECT status, quantity, "trialEndsAt" FROM "Subscription" WHERE "organizationId"=$1`, [r.orgId]);
    assert.deepEqual([org.status, sub.status, sub.quantity, sub.trialEndsAt], ["ACTIVE", "ACTIVE", 3, null]);
    const e = await getEntitlements(r.orgId);
    assert.equal(e.limits.projects, 3);
    const [u] = await q<{ passwordHash: string }>(`SELECT "passwordHash" FROM "User" WHERE email='boss@managed.test'`);
    const { verifyPassword } = await import("@/lib/security/password");
    for (const guess of ["", "password", PW, "boss@managed.test"]) assert.equal(await verifyPassword(guess, u.passwordHash), false);
  });

  await check("the same name twice gets different company codes", async () => {
    const a = await createCompanyByHand(operator, { ...goodInput, companyName: "Twin Name Ltd", adminEmail: "one@twin.test" }, "First");
    const b = await createCompanyByHand(operator, { ...goodInput, companyName: "Twin Name Ltd", adminEmail: "two@twin.test" }, "Second");
    const rows = await q<{ slug: string }>(`SELECT slug FROM "Organization" WHERE id IN ($1,$2)`, [a.orgId, b.orgId]);
    assert.equal(new Set(rows.map((r) => r.slug)).size, 2);
  });

  await check("bad input and an address that already has an account are refused, and nothing is created", async () => {
    const orgsBefore = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Organization"`))[0].n);
    await rejects(createCompanyByHand(operator, { ...goodInput, adminEmail: "asha@handmade.test" }, "Again"), /already has an account/);
    await rejects(createCompanyByHand(operator, { ...goodInput, adminEmail: "not-an-email" }, "x reason"), /valid email/);
    await rejects(createCompanyByHand(operator, { ...goodInput, companyName: "A" }, "x reason"), /company name/);
    await rejects(createCompanyByHand(operator, { ...goodInput, country: "ZZ" }, "x reason"), /country/i);
    await rejects(createCompanyByHand(operator, { ...goodInput, mode: "free-for-all" }, "x reason"), /free trial or a plan/);
    await rejects(createCompanyByHand(operator, { ...goodInput, days: 0 }, "x reason"), /1 to 365/);
    await rejects(createCompanyByHand(operator, { ...goodInput, mode: "managed", quantity: 0 }, "x reason"), /1 to 1000/);
    await rejects(createCompanyByHand(operator, { ...goodInput, adminEmail: "fresh@handmade.test" }, ""), /reason/);
    await rejects(createCompanyByHand(operator, { ...goodInput, adminEmail: "fresh@handmade.test" }, "ab"), /reason/);
    assert.equal(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Organization"`))[0].n), orgsBefore);
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email='fresh@handmade.test'`)).length, 0);
  });

  await check("creating a company is written to that company's audit log with who and why", async () => {
    const [row] = await q<{ details: { by: string; reason: string; adminEmail: string; emailed: boolean } }>(
      `SELECT a.details FROM "ActivityLog" a JOIN "Organization" o ON o.id=a."organizationId" WHERE o.name='Hand Made Builders' AND a.action='MASTER_CREATED_COMPANY'`,
    );
    assert.equal(row.details.by, operator.email);
    assert.equal(row.details.reason, "Partner deal agreed by email");
    assert.equal(row.details.adminEmail, "asha@handmade.test");
    assert.equal(row.details.emailed, true);
  });

  // ---- two-step reset
  const PW2 = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW2, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    return row;
  };
  const a = await makeCompany("Reset Alpha", "admin@reset-alpha.test");
  const b = await makeCompany("Reset Beta", "admin@reset-beta.test");
  const turnOnTwoStep = async (userId: string) => {
    await q(`UPDATE "User" SET "totpSecretEnc"='enc', "totpEnabledAt"=now(), "totpLastStep"=5 WHERE id=$1`, [userId]);
    await q(`INSERT INTO "RecoveryCode"(id,"userId","codeHash") VALUES ($1,$2,'h1'),($3,$2,'h2')`, [`rc_${userId}_1`, userId, `rc_${userId}_2`]);
    await q(`INSERT INTO "MobileSession"(id,"userId","organizationId","refreshHash","sessionVersion","refreshExpiresAt","absoluteExpiresAt") VALUES ($1,$2,$3,$4,0,now()+interval '1 day',now()+interval '1 day')`, [`ms_${userId}`, userId, a.orgId, `rh_${userId}`]);
  };

  await check("resetting two-step turns it off, removes recovery codes, signs the person out everywhere, tells them and logs it", async () => {
    await turnOnTwoStep(a.userId);
    const [before] = await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE id=$1`, [a.userId]);
    const r = await resetTwoStep(operator, a.orgId, a.userId, "Caller verified by video call", true);
    assert.equal(r.email, "admin@reset-alpha.test");
    const [u] = await q<{ totpSecretEnc: string | null; totpEnabledAt: Date | null; totpLastStep: number | null; sessionVersion: number }>(`SELECT "totpSecretEnc","totpEnabledAt","totpLastStep","sessionVersion" FROM "User" WHERE id=$1`, [a.userId]);
    assert.deepEqual([u.totpSecretEnc, u.totpEnabledAt, u.totpLastStep], [null, null, null]);
    assert.equal(u.sessionVersion, before.sessionVersion + 1);
    assert.equal((await q(`SELECT 1 FROM "RecoveryCode" WHERE "userId"=$1`, [a.userId])).length, 0);
    const [ms] = await q<{ revokedAt: Date | null; revokedReason: string | null }>(`SELECT "revokedAt","revokedReason" FROM "MobileSession" WHERE id=$1`, [`ms_${a.userId}`]);
    assert.ok(ms.revokedAt);
    assert.equal(ms.revokedReason, "two_step_reset");
    const mail = mails().filter((m) => m.to === "admin@reset-alpha.test" && /Two-step sign-in was turned off/.test(m.subject)).at(-1);
    assert.ok(mail, "the person was told");
    assert.match(mail.text, /If you did not ask for this/);
    const [log] = await q<{ details: { by: string; reason: string; person: string } }>(`SELECT details FROM "ActivityLog" WHERE "organizationId"=$1 AND action='MASTER_RESET_TWO_STEP'`, [a.orgId]);
    assert.deepEqual([log.details.by, log.details.reason, log.details.person], [operator.email, "Caller verified by video call", "admin@reset-alpha.test"]);
  });

  await check("a reset needs the identity box ticked and a real reason; nothing changes without them", async () => {
    await turnOnTwoStep(b.userId);
    await rejects(resetTwoStep(operator, b.orgId, b.userId, "Looks fine to me", false), /confirm you checked/);
    await rejects(resetTwoStep(operator, b.orgId, b.userId, "Looks fine to me", undefined), /confirm you checked/);
    await rejects(resetTwoStep(operator, b.orgId, b.userId, "", true), /reason/);
    const [u] = await q<{ totpEnabledAt: Date | null }>(`SELECT "totpEnabledAt" FROM "User" WHERE id=$1`, [b.userId]);
    assert.ok(u.totpEnabledAt, "still on");
  });

  await check("a reset is refused for yourself, for another operator, for someone without two-step, and for someone from another company", async () => {
    // someone with two-step off (Alpha's admin was reset above)
    await rejects(resetTwoStep(operator, a.orgId, a.userId, "Again please", true), /not turned on/);
    // the operator's own account, as a member of a company
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_op_1',$1,$2,'ADMIN')`, [operator.id, b.orgId]);
    await q(`UPDATE "User" SET "totpEnabledAt"=now() WHERE id=$1`, [operator.id]);
    await rejects(resetTwoStep(operator, b.orgId, operator.id, "Reset myself", true), /your own/);
    // another operator
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","isPlatformAdmin","totpEnabledAt","updatedAt") VALUES ('u_operator_2','Op Two','op2@platform.test','x',now(),true,now(),now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_op_2','u_operator_2',$1,'ADMIN')`, [b.orgId]);
    await rejects(resetTwoStep(operator, b.orgId, "u_operator_2", "Remove their protection", true), /platform operator/);
    // a person who belongs to a different company: Beta's admin through Alpha's page
    await rejects(resetTwoStep(operator, a.orgId, b.userId, "Wrong page", true), /not in this company/);
    // unknown company
    await rejects(resetTwoStep(operator, "no-such-company", b.userId, "Wrong page", true), /Company not found/);
    const [u] = await q<{ totpEnabledAt: Date | null }>(`SELECT "totpEnabledAt" FROM "User" WHERE id=$1`, [b.userId]);
    assert.ok(u.totpEnabledAt, "Beta's admin is untouched by all of those");
  });

  // ---- export
  const addInvoice = async (c: { orgId: string }, number: string) => {
    const vid = `v_${c.orgId}`;
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Export Vendor') ON CONFLICT DO NOTHING`, [vid, c.orgId]);
    const [p] = await q<{ id: string }>(`SELECT id FROM "Project" WHERE "organizationId"=$1 LIMIT 1`, [c.orgId]);
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","updatedAt") VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,100,100,'UNPAID','x',now())`, [`i_${number}_${c.orgId}`, c.orgId, number, p.id, vid]);
  };
  await addInvoice(a, "EXP-ALPHA-1");
  await addInvoice(b, "EXP-BETA-1");

  await check("an export of one company holds that company's data only, with people but no passwords", async () => {
    const data = await loadCompanyData(a.orgId, dbFor(a.orgId));
    assert.deepEqual(data.invoices.map((r) => r.invoiceNumber), ["EXP-ALPHA-1"]);
    assert.ok(!JSON.stringify(data).includes("EXP-BETA-1"));
    assert.ok(data.users.some((u) => u.email === "admin@reset-alpha.test"));
    assert.ok(!data.users.some((u) => u.email === "admin@reset-beta.test"));
    const text = JSON.stringify(data);
    assert.ok(!/passwordHash|totpSecret|azureKeyEnc|\$2[aby]\$/.test(text), "no secrets");
  });

  await check("the download is a real Excel file or JSON backup named for the company", async () => {
    const datasets = parseDataset("all")!;
    assert.equal(parseDataset("nonsense"), null);
    assert.deepEqual(parseDataset("invoices"), ["invoices"]);
    const company = { slug: "reset-alpha", label: "Reset Alpha" };
    const xlsx = await exportResponse({ orgId: a.orgId, db: dbFor(a.orgId), company, datasets, requested: "all", format: "xlsx" });
    assert.match(xlsx.headers.get("content-disposition")!, /reset-alpha-all-\d{4}-\d{2}-\d{2}\.xlsx/);
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "an xlsx file is a zip");
    const json = await exportResponse({ orgId: a.orgId, db: dbFor(a.orgId), company, datasets, requested: "all", format: "json" });
    assert.match(json.headers.get("content-disposition")!, /reset-alpha-backup-.*\.json/);
    assert.equal(json.headers.get("cache-control"), "private, no-store");
    const parsed = JSON.parse(await json.text()) as { data: { invoices: { invoiceNumber: string }[] } };
    assert.deepEqual(parsed.data.invoices.map((r) => r.invoiceNumber), ["EXP-ALPHA-1"]);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
