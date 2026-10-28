// Database-backed tests of the mobile number (sign-up, invitation, own account) and of an administrator helping a colleague
// who is locked out (reset link, or a new password). Run through `npm run test:isolation`.
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
let ipCounter = 60;
const ip = () => `198.51.107.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { createInvite, acceptInvite } = await import("@/lib/flows/invite");
  const { updateMyPhone } = await import("@/lib/flows/phone");
  const { setEmployeePassword, sendEmployeeResetLink } = await import("@/lib/flows/employee-password");
  const { verifyPassword } = await import("@/lib/security/password");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];
  const phoneOf = async (email: string) => (await q<{ phone: string | null }>(`SELECT phone FROM "User" WHERE email=$1`, [email]))[0]?.phone;

  const PW = "correct horse battery staple";
  const base = { companyName: "Phone Co", name: "Pat Admin", email: "pat@phone-co.test", password: PW, country: "IN", acceptTerms: true };

  await check("sign-up asks for a mobile number: missing or unreadable ones are refused, nothing is created", async () => {
    const none = await signUp({ ...base }, { ip: ip() });
    assert.ok(!none.ok && none.field === "phone", JSON.stringify(none));
    for (const bad of ["", "abc", "12345", "98765 4321", "1234567890"]) {
      const r = await signUp({ ...base, phone: bad }, { ip: ip() });
      assert.ok(!r.ok && r.field === "phone", `${bad} -> ${JSON.stringify(r)}`);
    }
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email=$1`, [base.email])).length, 0);
  });

  await check("a good number is saved in international form, whatever way it was typed", async () => {
    assert.ok((await signUp({ ...base, phone: "(098) 765-43210" }, { ip: ip() })).ok);
    assert.equal(await phoneOf(base.email), "+919876543210");
    // a company in Australia reads a local number as Australian; a + number is taken as typed
    assert.ok((await signUp({ ...base, companyName: "Aus Co", email: "al@aus-co.test", country: "AU", phone: "0412 345 678" }, { ip: ip() })).ok);
    assert.equal(await phoneOf("al@aus-co.test"), "+61412345678");
    assert.ok((await signUp({ ...base, companyName: "Uk Co", email: "uk@uk-co.test", country: "AU", phone: "+44 7911 123456" }, { ip: ip() })).ok);
    assert.equal(await phoneOf("uk@uk-co.test"), "+447911123456");
  });

  const confirm = async (email: string) => {
    const found = mails().filter((x) => x.to === email && /Confirm your email/.test(x.subject));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
  };
  await confirm(base.email);
  const [pat] = await q<{ userId: string; orgId: string }>(`SELECT u.id AS "userId", m."organizationId" AS "orgId" FROM "User" u JOIN "Membership" m ON m."userId"=u.id WHERE u.email=$1`, [base.email]);
  const admin = { id: pat.userId, orgId: pat.orgId, name: "Pat Admin" };

  const invite = async (email: string) => {
    assert.ok((await createInvite(admin, { email, role: "STAFF", projectIds: [] })).ok);
    return /token=([A-Za-z0-9_-]+)/.exec(mailsTo(email).at(-1)!.text)![1];
  };

  await check("a person joining by invitation gives a mobile number too; someone who already has an account does not need to", async () => {
    const token = await invite("lee@phone-co.test");
    const missing = await acceptInvite({ token, name: "Lee Worker", password: PW, acceptTerms: true }, null);
    assert.ok(!missing.ok && missing.field === "phone", JSON.stringify(missing));
    const bad = await acceptInvite({ token, name: "Lee Worker", password: PW, phone: "nope", acceptTerms: true }, null);
    assert.ok(!bad.ok && bad.field === "phone");
    const ok = await acceptInvite({ token, name: "Lee Worker", password: PW, phone: "98765 11111", acceptTerms: true }, null);
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.equal(await phoneOf("lee@phone-co.test"), "+919876511111");
    // the refused tries did not use up the invitation (the third one worked)
    // an existing account accepting another invitation keeps the number it has
    const [lee] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='lee@phone-co.test'`);
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_pp_b','Other Phone Co','o_pp_b','ACTIVE',now())`);
    await q(`INSERT INTO "Subscription"(id,"organizationId","planId",quantity,status,"trialEndsAt","updatedAt") VALUES ('s_pp_b','o_pp_b','plan_project',1,'TRIALING',now() + interval '10 days',now())`);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ('u_pp_b','Bea Boss','bea@other-phone.test','x',now(),now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_pp_b','u_pp_b','o_pp_b','ADMIN')`);
    assert.ok((await createInvite({ id: "u_pp_b", orgId: "o_pp_b", name: "Bea Boss" }, { email: "lee@phone-co.test", role: "STAFF", projectIds: [] })).ok);
    const t2 = /token=([A-Za-z0-9_-]+)/.exec(mailsTo("lee@phone-co.test").at(-1)!.text)![1];
    const joined = await acceptInvite({ token: t2 }, lee.id);
    assert.ok(joined.ok && joined.joinedExisting, JSON.stringify(joined));
    assert.equal(await phoneOf("lee@phone-co.test"), "+919876511111");
  });

  await check("a person changes their own number; an unreadable one is refused and nothing changes", async () => {
    const r = await updateMyPhone(pat.userId, "+61 412 345 678", pat.orgId);
    assert.ok(r.ok && r.phone === "+61412345678");
    assert.equal(await phoneOf(base.email), "+61412345678");
    const bad = await updateMyPhone(pat.userId, "hello", pat.orgId);
    assert.ok(!bad.ok && bad.field === "phone");
    assert.equal(await phoneOf(base.email), "+61412345678");
  });

  // ---- an administrator helping a colleague
  const [lee] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='lee@phone-co.test'`);
  const sam = async (email: string, extra = "") => {
    const token = await invite(email);
    assert.ok((await acceptInvite({ token, name: `Worker ${email}`, password: PW, phone: "9876500000", acceptTerms: true }, null)).ok);
    void extra;
    return (await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]))[0].id;
  };
  const alone = await sam("kim@phone-co.test");
  const stranger = "u_pp_b"; // belongs to the other company only

  await check("an administrator sets a new password for a colleague: it works, they are signed out everywhere, emailed, and it is logged", async () => {
    await q(`INSERT INTO "MobileSession"(id,"userId","organizationId","refreshHash","sessionVersion","refreshExpiresAt","absoluteExpiresAt") VALUES ('ms_pp_1',$1,$2,'hash-pp-1',0, now() + interval '10 days', now() + interval '60 days')`, [alone, pat.orgId]);
    const before = (await q<{ v: number }>(`SELECT "sessionVersion" AS v FROM "User" WHERE id=$1`, [alone]))[0].v;
    const r = await setEmployeePassword(admin, alone, "a brand new long phrase");
    assert.ok(r.ok, JSON.stringify(r));
    const [u] = await q<{ passwordHash: string; v: number }>(`SELECT "passwordHash", "sessionVersion" AS v FROM "User" WHERE id=$1`, [alone]);
    assert.ok(await verifyPassword("a brand new long phrase", u.passwordHash));
    assert.ok(!(await verifyPassword(PW, u.passwordHash)));
    assert.equal(u.v, before + 1, "web sessions end");
    assert.ok((await q<{ r: Date | null }>(`SELECT "revokedAt" AS r FROM "MobileSession" WHERE id='ms_pp_1'`))[0].r, "phone sessions end");
    const mail = mailsTo("kim@phone-co.test").at(-1)!;
    assert.match(mail.subject, /password was changed by Pat Admin/);
    assert.ok(!mail.text.includes("a brand new long phrase") && !mail.html.includes("a brand new long phrase"), "the password is never in the email");
    const [log] = await q<{ n: string }>(`SELECT count(*) AS n FROM "ActivityLog" WHERE "organizationId"=$1 AND action='PASSWORD_SET_BY_ADMIN' AND "entityId"=$2`, [pat.orgId, alone]);
    assert.equal(Number(log.n), 1);
  });

  await check("it is refused for yourself, for someone outside the company, for a person who also belongs to another company, for an operator, and for a weak password", async () => {
    const self = await setEmployeePassword(admin, pat.userId, "another long phrase here");
    assert.ok(!self.ok && /My account/.test(self.error));
    const outsider = await setEmployeePassword(admin, stranger, "another long phrase here");
    assert.ok(!outsider.ok && /not in your company/.test(outsider.error));
    // Lee belongs to both companies: one password for both, so only a reset link is possible
    const shared = await setEmployeePassword(admin, lee.id, "another long phrase here");
    assert.ok(!shared.ok && /other companies/.test(shared.error), JSON.stringify(shared));
    const hashBefore = (await q<{ h: string }>(`SELECT "passwordHash" AS h FROM "User" WHERE id=$1`, [lee.id]))[0].h;
    await q(`UPDATE "User" SET "isPlatformAdmin"=true WHERE id=$1`, [alone]);
    const op = await setEmployeePassword(admin, alone, "another long phrase here");
    assert.ok(!op.ok);
    await q(`UPDATE "User" SET "isPlatformAdmin"=false WHERE id=$1`, [alone]);
    const weak = await setEmployeePassword(admin, alone, "password123");
    assert.ok(!weak.ok && weak.field === "password");
    assert.ok(!(await setEmployeePassword(admin, alone, 12345 as never)).ok);
    assert.equal((await q<{ h: string }>(`SELECT "passwordHash" AS h FROM "User" WHERE id=$1`, [lee.id]))[0].h, hashBefore, "nothing changed for the other company's person");
  });

  await check("a reset link goes to the colleague's own inbox, also for a person who belongs to two companies; never for an outsider", async () => {
    const r = await sendEmployeeResetLink(admin, lee.id, { ip: ip() });
    assert.ok(r.ok, JSON.stringify(r));
    const mail = mailsTo("lee@phone-co.test").at(-1)!;
    assert.match(mail.subject, /reset/i);
    assert.match(mail.text, /reset-password\?token=/);
    const out = await sendEmployeeResetLink(admin, stranger, { ip: ip() });
    assert.ok(!out.ok && /not in your company/.test(out.error));
    assert.equal(mailsTo("bea@other-phone.test").length, 0);
    const [log] = await q<{ n: string }>(`SELECT count(*) AS n FROM "ActivityLog" WHERE "organizationId"=$1 AND action='PASSWORD_RESET_LINK_SENT'`, [pat.orgId]);
    assert.equal(Number(log.n), 1);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
