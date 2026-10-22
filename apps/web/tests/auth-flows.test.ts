// Database-backed tests of the account flows (sign-up, verification, reset, invitations, deletion, rate limits).
// Run through `npm run test:isolation`, which gives this process a real PostgreSQL, the ordinary app role
// (so Row-Level Security applies) and EMAIL_TRANSPORT=file so every email can be read back here.
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
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 4).join("\n      ")}`);
  }
}

type Mail = { to: string; subject: string; text: string; html: string };
const readMails = (): Mail[] =>
  fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const mailsTo = (email: string) => readMails().filter((m) => m.to === email);
const tokenIn = (m: Mail) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1];
const lastTokenFor = (email: string, subjectPart: string) => {
  const found = mailsTo(email).filter((m) => m.subject.includes(subjectPart));
  assert.ok(found.length > 0, `no "${subjectPart}" email to ${email}`);
  return tokenIn(found[found.length - 1]);
};

let ipCounter = 0;
const ip = () => `198.51.100.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail, resendVerification, requestPasswordReset, resetPassword } = await import("@/lib/flows/verify-reset");
  const { createInvite, listPendingInvites, revokeInvite, describeInvite, acceptInvite } = await import("@/lib/flows/invite");
  const { changePassword, signOutEverywhere, deleteAccount, closeCompany, listMyCompanies, companiesOnlyAdministeredBy } = await import("@/lib/flows/account");
  const { issueToken, peekToken, consumeToken, hashToken } = await import("@/lib/security/tokens");
  const { hit } = await import("@/lib/security/rate-limit");
  const { verifyPassword } = await import("@/lib/security/password");
  const { rawDb } = await import("@/lib/db");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const signUpBase = { companyName: "Acme Co", name: "Ann Admin", email: "ann@acme-co.test", password: PW, country: "AU", acceptTerms: true };

  // =================================================================== sign-up
  await check("sign-up: creates the company (trial), admin, starter categories and a first project, and emails a confirmation link", async () => {
    const r = await signUp(signUpBase, { ip: ip() });
    assert.deepEqual(r, { ok: true, checkEmail: true });
    const [org] = await q<{ id: string; slug: string; status: string; country: string; currency: string; timezone: string }>(`SELECT * FROM "Organization" WHERE name='Acme Co'`);
    assert.equal(org.slug, "acme-co");
    assert.equal(org.status, "TRIAL");
    assert.deepEqual([org.country, org.currency, org.timezone], ["AU", "AUD", "Australia/Sydney"]);
    const [{ c }] = await q<{ c: number }>(`SELECT count(*)::int c FROM "Category" WHERE "organizationId"=$1`, [org.id]);
    assert.equal(c, 8);
    const projects = await q<{ name: string }>(`SELECT name FROM "Project" WHERE "organizationId"=$1`, [org.id]);
    assert.deepEqual(projects.map((p) => p.name), ["My first project"]);
    const [u] = await q<{ passwordHash: string; emailVerifiedAt: Date | null; termsAcceptedAt: Date | null; id: string }>(`SELECT * FROM "User" WHERE email='ann@acme-co.test'`);
    assert.equal(u.emailVerifiedAt, null, "not usable until the address is confirmed");
    assert.ok(u.termsAcceptedAt);
    assert.ok(u.passwordHash.startsWith("$2") && !u.passwordHash.includes(PW));
    const [m] = await q<{ role: string }>(`SELECT role FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2`, [u.id, org.id]);
    assert.equal(m.role, "ADMIN");
    assert.equal((await q(`SELECT 1 FROM "ProjectAssignment" WHERE "userId"=$1`, [u.id])).length, 1);
    const verify = mailsTo("ann@acme-co.test").filter((x) => x.subject.includes("Confirm your email"));
    assert.equal(verify.length, 1);
    assert.match(verify[0].text, /http:\/\/app\.test\/verify-email\?token=/, "links point at the configured address, not the request");
    assert.equal((await dbFor(org.id).activityLog.findMany({ where: { action: "USER_SIGNED_UP" } })).length, 1);
  });

  await check("sign-up: an existing email gets the SAME answer and no second company (it receives an 'already have an account' email)", async () => {
    const before = (await q<{ c: number }>(`SELECT count(*)::int c FROM "Organization"`))[0].c;
    const r = await signUp({ ...signUpBase, companyName: "Second Try Ltd" }, { ip: ip() });
    assert.deepEqual(r, { ok: true, checkEmail: true });
    assert.equal((await q<{ c: number }>(`SELECT count(*)::int c FROM "Organization"`))[0].c, before);
    assert.equal(mailsTo("ann@acme-co.test").filter((x) => x.subject.includes("Someone tried")).length, 1);
    assert.equal(mailsTo("ann@acme-co.test").filter((x) => x.subject.includes("Confirm your email")).length, 1);
  });

  await check("sign-up: weak passwords, a missing agreement and bad emails are refused with the field named", async () => {
    const weak = await signUp({ ...signUpBase, email: "w1@acme-co.test", password: "password123" }, { ip: ip() });
    assert.ok(!weak.ok && weak.field === "password");
    const terms = await signUp({ ...signUpBase, email: "w2@acme-co.test", acceptTerms: false }, { ip: ip() });
    assert.ok(!terms.ok && terms.field === "acceptTerms");
    const mail = await signUp({ ...signUpBase, email: "not-an-email" }, { ip: ip() });
    assert.ok(!mail.ok && mail.field === "email");
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email IN ('w1@acme-co.test','w2@acme-co.test')`)).length, 0);
  });

  await check("sign-up: the 4th attempt for one address within an hour is refused", async () => {
    const email = "limit@acme-co.test";
    for (let i = 0; i < 3; i++) assert.ok((await signUp({ ...signUpBase, email, companyName: `Limit ${i}` }, { ip: ip() })).ok);
    const r = await signUp({ ...signUpBase, email, companyName: "Limit 4" }, { ip: ip() });
    assert.ok(!r.ok && /Too many attempts/.test(r.error));
  });

  await check("sign-up: two simultaneous sign-ups for the same address create exactly one account", async () => {
    const email = "race@acme-co.test";
    const results = await Promise.all([
      signUp({ ...signUpBase, email, companyName: "Race One" }, { ip: ip() }),
      signUp({ ...signUpBase, email, companyName: "Race Two" }, { ip: ip() }),
    ]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email=$1`, [email])).length, 1);
  });

  // =================================================================== verification
  await check("verify: looking at a link does not use it up; confirming works once; a second use fails", async () => {
    const token = lastTokenFor("ann@acme-co.test", "Confirm your email");
    assert.ok(await peekToken(token, "EMAIL_VERIFY"));
    assert.ok(await peekToken(token, "EMAIL_VERIFY"), "still valid after being looked at");
    const r = await confirmEmail(token);
    assert.ok(r.ok && r.email === "ann@acme-co.test");
    const [u] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='ann@acme-co.test'`);
    assert.ok(u.emailVerifiedAt);
    assert.equal((await confirmEmail(token)).ok, false);
  });
  await check("verify: tampered, wrong-kind and expired links are refused", async () => {
    const [u] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='race@acme-co.test'`);
    const good = await issueToken({ type: "EMAIL_VERIFY", email: "race@acme-co.test", userId: u.id });
    assert.equal((await confirmEmail(good.slice(0, -2) + "xx")).ok, false);
    assert.equal((await confirmEmail("short")).ok, false);
    assert.equal((await confirmEmail(null)).ok, false);
    const wrongKind = await issueToken({ type: "PASSWORD_RESET", email: "race@acme-co.test", userId: u.id });
    assert.equal((await confirmEmail(wrongKind)).ok, false, "a reset link cannot confirm an email");
    assert.ok((await confirmEmail(good)).ok, "the real link still works after all of that");
    // (issuing a newer link of the same kind cancels the older one, so the expired one comes last)
    const expired = await issueToken({ type: "EMAIL_VERIFY", email: "race@acme-co.test", userId: u.id, ttlMs: -1000 });
    assert.equal((await confirmEmail(expired)).ok, false);
    assert.equal(await peekToken(expired, "EMAIL_VERIFY"), null);
  });
  await check("verify: only the hash of a link is stored, never the link itself", async () => {
    const token = await issueToken({ type: "EMAIL_VERIFY", email: "hash@acme-co.test" });
    assert.equal((await q(`SELECT 1 FROM "AuthToken" WHERE "tokenHash"=$1`, [token])).length, 0);
    const [row] = await q<{ tokenHash: string }>(`SELECT "tokenHash" FROM "AuthToken" WHERE "tokenHash"=$1`, [hashToken(token)]);
    assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  });
  await check("verify: resending answers the same for unknown, unconfirmed and confirmed addresses, and mails only the unconfirmed", async () => {
    await signUp({ ...signUpBase, email: "resend@acme-co.test", companyName: "Resend Co" }, { ip: ip() });
    const first = lastTokenFor("resend@acme-co.test", "Confirm your email");
    const a = await resendVerification("nobody@nowhere.test", { ip: ip() });
    const b = await resendVerification("resend@acme-co.test", { ip: ip() });
    const c = await resendVerification("ann@acme-co.test", { ip: ip() }); // already confirmed
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(a.ok && a.message, b.ok && b.message, "same words either way");
    assert.equal(mailsTo("nobody@nowhere.test").length, 0);
    assert.equal(mailsTo("resend@acme-co.test").filter((m) => m.subject.includes("Confirm your email")).length, 2);
    assert.equal(mailsTo("ann@acme-co.test").filter((m) => m.subject.includes("Confirm your email")).length, 1, "confirmed address gets nothing new");
    assert.equal(await peekToken(first, "EMAIL_VERIFY"), null, "the older link stops working");
  });

  // =================================================================== password reset
  await check("reset: unknown addresses get the same answer and no email; known ones get a link; a newer link cancels the older", async () => {
    const a = await requestPasswordReset("ghost@nowhere.test", { ip: ip() });
    const b = await requestPasswordReset("ann@acme-co.test", { ip: ip() });
    assert.ok(a.ok && b.ok && a.message === b.message);
    assert.equal(mailsTo("ghost@nowhere.test").length, 0);
    const t1 = lastTokenFor("ann@acme-co.test", "Reset your");
    await requestPasswordReset("ann@acme-co.test", { ip: ip() });
    const t2 = lastTokenFor("ann@acme-co.test", "Reset your");
    assert.notEqual(t1, t2);
    assert.equal(await peekToken(t1, "PASSWORD_RESET"), null);
    assert.ok(await peekToken(t2, "PASSWORD_RESET"));
  });
  await check("reset: a weak password is refused WITHOUT using the link; a good one works once, ends every session and notifies by email", async () => {
    const token = lastTokenFor("ann@acme-co.test", "Reset your");
    const [before] = await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE email='ann@acme-co.test'`);
    const weak = await resetPassword({ token, password: "password123" });
    assert.ok(!weak.ok && weak.field === "password");
    assert.ok(await peekToken(token, "PASSWORD_RESET"), "link still usable after a refused attempt");
    const NEW = "a brand new passphrase 2026";
    assert.ok((await resetPassword({ token, password: NEW })).ok);
    const [u] = await q<{ passwordHash: string; sessionVersion: number }>(`SELECT "passwordHash","sessionVersion" FROM "User" WHERE email='ann@acme-co.test'`);
    assert.equal(u.sessionVersion, before.sessionVersion + 1);
    assert.equal(await verifyPassword(NEW, u.passwordHash), true);
    assert.equal(await verifyPassword(PW, u.passwordHash), false);
    assert.equal((await resetPassword({ token, password: "yet another passphrase 77" })).ok, false, "single use");
    assert.equal(mailsTo("ann@acme-co.test").filter((m) => m.subject.includes("password was changed")).length, 1);
  });
  await check("reset: an expired link is refused; a reset also confirms an unconfirmed address", async () => {
    const [u] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='resend@acme-co.test'`);
    const old = await issueToken({ type: "PASSWORD_RESET", email: "resend@acme-co.test", userId: u.id, ttlMs: -5 });
    assert.equal((await resetPassword({ token: old, password: "some long enough phrase" })).ok, false);
    const fresh = await issueToken({ type: "PASSWORD_RESET", email: "resend@acme-co.test", userId: u.id });
    assert.ok((await resetPassword({ token: fresh, password: "some long enough phrase" })).ok);
    const [after] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE id=$1`, [u.id]);
    assert.ok(after.emailVerifiedAt);
  });

  // =================================================================== invitations
  // a second company with its own admin, confirmed
  await signUp({ ...signUpBase, email: "bea@beta-co.test", name: "Bea Boss", companyName: "Beta Co" }, { ip: ip() });
  assert.ok((await confirmEmail(lastTokenFor("bea@beta-co.test", "Confirm your email"))).ok);
  const [acme] = await q<{ id: string }>(`SELECT id FROM "Organization" WHERE slug='acme-co'`);
  const [beta] = await q<{ id: string }>(`SELECT id FROM "Organization" WHERE slug='beta-co'`);
  const [ann] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='ann@acme-co.test'`);
  const [bea] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='bea@beta-co.test'`);
  const [acmeProject] = await q<{ id: string }>(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [acme.id]);
  const [betaProject] = await q<{ id: string }>(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [beta.id]);
  const annAdmin = { id: ann.id, name: "Ann Admin", orgId: acme.id };
  const beaAdmin = { id: bea.id, name: "Bea Boss", orgId: beta.id };

  await check("invite: sends an email to the invitee naming the company; lists only the inviting company's open invitations", async () => {
    const r = await createInvite(annAdmin, { email: "Sam@Staff.test", role: "STAFF", projectIds: [acmeProject.id] });
    assert.ok(r.ok);
    const mail = mailsTo("sam@staff.test").find((m) => m.subject.includes("invited you"));
    assert.ok(mail && mail.subject.includes("Acme Co") && /accept-invite\?token=/.test(mail.text));
    const pending = await listPendingInvites(acme.id);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].email, "sam@staff.test");
    assert.equal((await listPendingInvites(beta.id)).length, 0, "another company sees none of them");
  });
  await check("invite: another company cannot cancel it; the inviting company can", async () => {
    const [{ id }] = await listPendingInvites(acme.id);
    assert.equal((await revokeInvite(beaAdmin, id)).ok, false);
    assert.equal((await listPendingInvites(acme.id)).length, 1);
    assert.ok((await revokeInvite(annAdmin, id)).ok);
    assert.equal((await listPendingInvites(acme.id)).length, 0);
    const old = lastTokenFor("sam@staff.test", "invited you");
    assert.equal(await describeInvite(old), null, "a cancelled link is dead");
    assert.equal((await acceptInvite({ token: old, name: "Sam", password: "a long enough phrase", acceptTerms: true }, null)).ok, false);
  });
  await check("invite: bad requests are refused (another company's project, an existing member, an unknown role)", async () => {
    const foreign = await createInvite(annAdmin, { email: "x1@staff.test", role: "STAFF", projectIds: [betaProject.id] });
    assert.ok(!foreign.ok && /projects were not found/.test(foreign.error));
    const member = await createInvite(annAdmin, { email: "ann@acme-co.test", role: "STAFF", projectIds: [] });
    assert.ok(!member.ok && /already belongs/.test(member.error));
    const role = await createInvite(annAdmin, { email: "x2@staff.test", role: "OWNER", projectIds: [] });
    assert.equal(role.ok, false);
    assert.equal(mailsTo("x1@staff.test").length + mailsTo("x2@staff.test").length, 0);
  });
  await check("invite: a new person sets a name and password, becomes confirmed, joins with the chosen role and projects; the link works once", async () => {
    assert.ok((await createInvite(annAdmin, { email: "sam@staff.test", role: "STAFF", projectIds: [acmeProject.id] })).ok);
    const token = lastTokenFor("sam@staff.test", "invited you");
    const info = await describeInvite(token);
    assert.ok(info && info.company === "Acme Co" && info.hasAccount === false && info.role === "STAFF");
    const weak = await acceptInvite({ token, name: "Sam Staff", password: "password123", acceptTerms: true }, null);
    assert.ok(!weak.ok && weak.field === "password");
    const noTerms = await acceptInvite({ token, name: "Sam Staff", password: PW, acceptTerms: false }, null);
    assert.ok(!noTerms.ok && noTerms.field === "acceptTerms");
    assert.ok(await describeInvite(token), "refused attempts did not use the link up");
    const r = await acceptInvite({ token, name: "Sam Staff", password: PW, acceptTerms: true }, null);
    assert.ok(r.ok && r.slug === "acme-co" && r.joinedExisting === false);
    const [sam] = await q<{ id: string; emailVerifiedAt: Date | null }>(`SELECT id,"emailVerifiedAt" FROM "User" WHERE email='sam@staff.test'`);
    assert.ok(sam.emailVerifiedAt, "the link reached their inbox, so the address counts as confirmed");
    const [m] = await q<{ role: string }>(`SELECT role FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2`, [sam.id, acme.id]);
    assert.equal(m.role, "STAFF");
    assert.equal((await q(`SELECT 1 FROM "ProjectAssignment" WHERE "userId"=$1 AND "projectId"=$2`, [sam.id, acmeProject.id])).length, 1);
    assert.equal((await acceptInvite({ token, name: "Sam Again", password: PW, acceptTerms: true }, null)).ok, false, "single use");
  });
  await check("invite: someone who already has an account must be signed in as that account; they then join a second company", async () => {
    assert.ok((await createInvite(annAdmin, { email: "bea@beta-co.test", role: "ADMIN", projectIds: [] })).ok);
    const token = lastTokenFor("bea@beta-co.test", "invited you");
    const info = await describeInvite(token);
    assert.ok(info && info.hasAccount && info.existingUserId === bea.id);
    const anon = await acceptInvite({ token }, null);
    assert.ok(!anon.ok && /Sign in as bea@beta-co\.test/.test(anon.error));
    const other = await acceptInvite({ token }, ann.id);
    assert.ok(!other.ok && /Sign in as/.test(other.error), "someone else's session does not count");
    assert.ok(await describeInvite(token), "still open");
    const [pwBefore] = await q<{ passwordHash: string }>(`SELECT "passwordHash" FROM "User" WHERE id=$1`, [bea.id]);
    const ok = await acceptInvite({ token }, bea.id);
    assert.ok(ok.ok && ok.joinedExisting === true);
    const companies = await listMyCompanies(bea.id);
    assert.deepEqual(companies.map((c) => c.name).sort(), ["Acme Co", "Beta Co"]);
    const [pwAfter] = await q<{ passwordHash: string }>(`SELECT "passwordHash" FROM "User" WHERE id=$1`, [bea.id]);
    assert.equal(pwAfter.passwordHash, pwBefore.passwordHash, "joining a company never touches the password");
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email='bea@beta-co.test'`)).length, 1);
  });
  await check("invite: an expired invitation is refused", async () => {
    const t = await issueToken({ type: "INVITE", email: "late@staff.test", organizationId: acme.id, role: "STAFF", ttlMs: -1000, payload: { projectIds: [] } });
    assert.equal(await describeInvite(t), null);
    assert.equal((await acceptInvite({ token: t, name: "Late", password: PW, acceptTerms: true }, null)).ok, false);
  });

  // =================================================================== account
  await check("account: changing the password needs the current one, follows the password rule, ends other sessions and emails a notice", async () => {
    const samId = (await q<{ id: string }>(`SELECT id FROM "User" WHERE email='sam@staff.test'`))[0].id;
    const wrong = await changePassword(samId, "not my password", "another long passphrase 9");
    assert.ok(!wrong.ok && wrong.field === "password");
    const weak = await changePassword(samId, PW, "password123");
    assert.ok(!weak.ok && weak.field === "newPassword");
    const [before] = await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE id=$1`, [samId]);
    assert.ok((await changePassword(samId, PW, "another long passphrase 9")).ok);
    const [after] = await q<{ sessionVersion: number; passwordHash: string }>(`SELECT "sessionVersion","passwordHash" FROM "User" WHERE id=$1`, [samId]);
    assert.equal(after.sessionVersion, before.sessionVersion + 1);
    assert.equal(await verifyPassword("another long passphrase 9", after.passwordHash), true);
    assert.equal(mailsTo("sam@staff.test").filter((m) => m.subject.includes("password was changed")).length, 1);
    assert.ok((await signOutEverywhere(samId)).ok);
    assert.equal((await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE id=$1`, [samId]))[0].sessionVersion, after.sessionVersion + 1);
  });
  await check("account: password guessing on a signed-in account is limited", async () => {
    const samId = (await q<{ id: string }>(`SELECT id FROM "User" WHERE email='sam@staff.test'`))[0].id;
    let refused = false;
    for (let i = 0; i < 14 && !refused; i++) {
      const r = await changePassword(samId, `wrong guess ${i}`, "another long passphrase 10");
      if (!r.ok && /Too many attempts/.test(r.error)) refused = true;
    }
    assert.ok(refused);
  });

  await check("deletion: the only administrator of a company cannot delete their account; the message names the company", async () => {
    assert.deepEqual((await companiesOnlyAdministeredBy(ann.id)).map((c) => c.name), []); // Bea is also an admin of Acme now
    // Bea is now an ADMIN of Acme too, so Ann is no longer the only one. Make Ann the only admin again to test the block:
    await q(`UPDATE "Membership" SET role='STAFF' WHERE "userId"=$1 AND "organizationId"=$2`, [bea.id, acme.id]);
    const blocked = await deleteAccount(ann.id, "a brand new passphrase 2026");
    assert.ok(!blocked.ok && /only administrator of "Acme Co"/.test(blocked.error), JSON.stringify(blocked));
    assert.equal((await q(`SELECT 1 FROM "User" WHERE id=$1 AND "deletedAt" IS NULL`, [ann.id])).length, 1);
  });
  await check("deletion: with another administrator in place, the account is erased but the records stay valid; the address can be used again", async () => {
    await q(`UPDATE "Membership" SET role='ADMIN' WHERE "userId"=$1 AND "organizationId"=$2`, [bea.id, acme.id]);
    await dbFor(acme.id).projectNote.create({ data: { organizationId: acme.id, projectId: acmeProject.id, userId: ann.id, content: "written by Ann" } });
    const wrongPw = await deleteAccount(ann.id, "wrong");
    assert.ok(!wrongPw.ok && wrongPw.field === "password");
    const r = await deleteAccount(ann.id, "a brand new passphrase 2026");
    assert.ok(r.ok, JSON.stringify(r));
    const [u] = await q<{ name: string; email: string; deletedAt: Date | null; emailVerifiedAt: Date | null }>(`SELECT name,email,"deletedAt","emailVerifiedAt" FROM "User" WHERE id=$1`, [ann.id]);
    assert.equal(u.name, "Deleted user");
    assert.match(u.email, /@deleted\.invalid$/);
    assert.ok(u.deletedAt);
    assert.equal(u.emailVerifiedAt, null);
    assert.equal((await q(`SELECT 1 FROM "Membership" WHERE "userId"=$1`, [ann.id])).length, 0);
    assert.equal((await q(`SELECT 1 FROM "ProjectAssignment" WHERE "userId"=$1`, [ann.id])).length, 0);
    assert.equal((await q(`SELECT 1 FROM "AuthToken" WHERE email='ann@acme-co.test'`)).length, 0);
    assert.equal((await q(`SELECT 1 FROM "ProjectNote" WHERE "userId"=$1`, [ann.id])).length, 1, "history is kept");
    assert.equal(mailsTo("ann@acme-co.test").filter((m) => m.subject.includes("account was deleted")).length, 1);
    // the old address can start over, and a deleted account cannot be reset into
    const reset = await requestPasswordReset("deleted-" + ann.id + "@deleted.invalid", { ip: ip() });
    assert.ok(reset.ok);
    assert.equal(mailsTo("deleted-" + ann.id + "@deleted.invalid").length, 0);
    assert.ok((await signUp({ ...signUpBase, companyName: "Ann Again Ltd" }, { ip: ip() })).ok);
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email='ann@acme-co.test' AND "deletedAt" IS NULL`)).length, 1);
  });

  await check("closing a company: needs an administrator and their password; cancels invitations, signs everyone out, hides it from switchers", async () => {
    // Acme still has Bea (admin) and Sam (staff). Sam is not allowed; the right password is required.
    const samId = (await q<{ id: string }>(`SELECT id FROM "User" WHERE email='sam@staff.test'`))[0].id;
    const notAdmin = await closeCompany({ id: samId, orgId: acme.id }, "another long passphrase 9");
    assert.equal(notAdmin.ok, false);
    const badPw = await closeCompany({ id: bea.id, orgId: acme.id }, "nope");
    assert.ok(!badPw.ok && badPw.field === "password");
    assert.ok((await createInvite({ id: bea.id, name: "Bea Boss", orgId: acme.id }, { email: "pending@staff.test", role: "STAFF", projectIds: [] })).ok);
    const pendingToken = lastTokenFor("pending@staff.test", "invited you");
    const [svBefore] = await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE id=$1`, [samId]);
    const [beaPw] = await q<{ passwordHash: string }>(`SELECT "passwordHash" FROM "User" WHERE id=$1`, [bea.id]);
    assert.ok(beaPw);
    // Bea's password is her original sign-up password
    const r = await closeCompany({ id: bea.id, orgId: acme.id }, PW);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal((await q<{ status: string }>(`SELECT status FROM "Organization" WHERE id=$1`, [acme.id]))[0].status, "CLOSED");
    assert.equal(await describeInvite(pendingToken), null);
    assert.equal((await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE id=$1`, [samId]))[0].sessionVersion, svBefore.sessionVersion + 1);
    assert.deepEqual((await listMyCompanies(bea.id)).map((c) => c.name), ["Beta Co"]);
    assert.deepEqual(await listMyCompanies(samId), []);
  });

  // =================================================================== limits
  await check("rate limit: 40 simultaneous attempts against a limit of 10 let exactly 10 through", async () => {
    const key = `test:burst:${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 40 }, () => hit(key, 10, 120)));
    assert.equal(results.filter((r) => r.allowed).length, 10);
    assert.ok(results.filter((r) => !r.allowed).every((r) => r.retryAfterSeconds >= 1 && r.retryAfterSeconds <= 120));
  });
  await check("rate limit: the window ends and the counter starts again", async () => {
    const key = `test:window:${Date.now()}`;
    assert.equal((await hit(key, 2, 1)).allowed, true);
    assert.equal((await hit(key, 2, 1)).allowed, true);
    assert.equal((await hit(key, 2, 1)).allowed, false);
    await new Promise((r) => setTimeout(r, 1300));
    const again = await hit(key, 2, 1);
    assert.ok(again.allowed && again.count === 1);
  });
  await check("tokens: a link claimed by two simultaneous requests is used exactly once", async () => {
    const [u] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='bea@beta-co.test'`);
    const token = await issueToken({ type: "EMAIL_VERIFY", email: "bea@beta-co.test", userId: u.id });
    const results = await Promise.all(Array.from({ length: 8 }, () => consumeToken(token, "EMAIL_VERIFY")));
    assert.equal(results.filter(Boolean).length, 1);
  });
  await check("data protection: sign-up wrote company rows through Row-Level Security without leaking across companies", async () => {
    const a = await dbFor(acme.id).category.count();
    const b = await dbFor(beta.id).category.count();
    assert.equal(a, 8);
    assert.equal(b, 8);
    assert.equal((await rawDb.category.findMany()).length, 0, "no company set means nothing is visible");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
