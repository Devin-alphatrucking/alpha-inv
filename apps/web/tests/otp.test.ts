// Database-backed tests of one-time email codes: the code store, sign-up confirmation, password reset and "confirm it is you".
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
const codeIn = (m: Mail) => /(\d{3}) (\d{3})/.exec(m.text)!.slice(1, 3).join("");
let ipCounter = 200;
const ip = () => `198.51.105.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail, confirmEmailWithCode, resendVerification, requestPasswordReset, resetPasswordWithCode } = await import("@/lib/flows/verify-reset");
  const { issueOtp, verifyOtp, recentlyConfirmed } = await import("@/lib/security/otp");
  const { sendStepUpCode, checkStepUp } = await import("@/lib/security/step-up");
  const { verifyPassword } = await import("@/lib/security/password");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];
  const backdate = (email: string, purpose: string, seconds: number) =>
    q(`UPDATE "OtpCode" SET "createdAt" = "createdAt" - make_interval(secs => $3), "expiresAt" = "expiresAt" - make_interval(secs => $3) WHERE email=$1 AND purpose=$2`, [email, purpose, seconds]);

  const PW = "correct horse battery staple";

  // ---------------------------------------------------------------- the store
  await check("a code is six digits, works once, and is stored only as a hash", async () => {
    const issued = await issueOtp({ purpose: "SIGNUP", email: "store1@otp.test" });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    assert.match(issued.code, /^\d{6}$/);
    const [row] = await q<{ codeHash: string }>(`SELECT "codeHash" FROM "OtpCode" WHERE email='store1@otp.test'`);
    assert.ok(!row.codeHash.includes(issued.code) && /^[0-9a-f]{64}$/.test(row.codeHash));
    assert.deepEqual(await verifyOtp({ purpose: "SIGNUP", email: "STORE1@otp.test", code: issued.code }), { ok: true, userId: null });
    const again = await verifyOtp({ purpose: "SIGNUP", email: "store1@otp.test", code: issued.code });
    assert.equal(again.ok, false, "the same code cannot be used twice");
  });

  await check("a wrong code is counted; five wrong tries lock the code, even for the right one afterwards", async () => {
    const issued = await issueOtp({ purpose: "SIGNUP", email: "store2@otp.test" });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    const wrong = issued.code === "000000" ? "111111" : "000000";
    const first = await verifyOtp({ purpose: "SIGNUP", email: "store2@otp.test", code: wrong });
    assert.ok(!first.ok && first.reason === "wrong" && /4 tries left/.test(first.error));
    for (let i = 0; i < 4; i++) await verifyOtp({ purpose: "SIGNUP", email: "store2@otp.test", code: wrong });
    const locked = await verifyOtp({ purpose: "SIGNUP", email: "store2@otp.test", code: issued.code });
    assert.ok(!locked.ok && locked.reason === "locked", "the right code no longer works after five wrong ones");
    const [row] = await q<{ attempts: number; usedAt: Date | null }>(`SELECT attempts, "usedAt" FROM "OtpCode" WHERE email='store2@otp.test'`);
    assert.deepEqual([row.attempts, row.usedAt], [5, null]);
  });

  await check("parallel guesses cannot beat the limit of five", async () => {
    const issued = await issueOtp({ purpose: "SIGNUP", email: "store3@otp.test" });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    const wrong = issued.code === "123456" ? "654321" : "123456";
    await Promise.all(Array.from({ length: 12 }, () => verifyOtp({ purpose: "SIGNUP", email: "store3@otp.test", code: wrong })));
    const [row] = await q<{ attempts: number }>(`SELECT attempts FROM "OtpCode" WHERE email='store3@otp.test'`);
    assert.equal(row.attempts, 5, "12 parallel tries counted as exactly 5");
  });

  await check("a code expires after ten minutes", async () => {
    const issued = await issueOtp({ purpose: "SIGNUP", email: "store4@otp.test" });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    const late = await verifyOtp({ purpose: "SIGNUP", email: "store4@otp.test", code: issued.code, now: new Date(Date.now() + 10 * 60 * 1000 + 1000) });
    assert.ok(!late.ok && late.reason === "expired");
    const early = await verifyOtp({ purpose: "SIGNUP", email: "store4@otp.test", code: issued.code, now: new Date(Date.now() + 9 * 60 * 1000) });
    assert.ok(early.ok, "still good at nine minutes");
  });

  await check("asking again cancels the earlier code, but not within 30 seconds", async () => {
    const first = await issueOtp({ purpose: "PASSWORD_RESET", email: "store5@otp.test" });
    assert.ok(first.ok);
    const tooSoon = await issueOtp({ purpose: "PASSWORD_RESET", email: "store5@otp.test" });
    assert.ok(!tooSoon.ok && /Wait \d+ seconds?/.test(tooSoon.error));
    await backdate("store5@otp.test", "PASSWORD_RESET", 40);
    const second = await issueOtp({ purpose: "PASSWORD_RESET", email: "store5@otp.test" });
    assert.ok(second.ok && first.ok);
    if (!second.ok || !first.ok) return;
    assert.ok(!(await verifyOtp({ purpose: "PASSWORD_RESET", email: "store5@otp.test", code: first.code })).ok || first.code === second.code, "the old code is cancelled");
    assert.ok((await verifyOtp({ purpose: "PASSWORD_RESET", email: "store5@otp.test", code: second.code })).ok);
  });

  await check("a code only works for its own purpose, address and person", async () => {
    const issued = await issueOtp({ purpose: "SIGNUP", email: "store6@otp.test", userId: "u_a" });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    assert.ok(!(await verifyOtp({ purpose: "PASSWORD_RESET", email: "store6@otp.test", code: issued.code })).ok, "another purpose");
    assert.ok(!(await verifyOtp({ purpose: "SIGNUP", email: "other@otp.test", code: issued.code })).ok, "another address");
    assert.ok(!(await verifyOtp({ purpose: "SIGNUP", email: "store6@otp.test", code: issued.code, userId: "u_b" })).ok, "another person");
    for (const junk of ["", "abc", "12345", null, undefined]) assert.ok(!(await verifyOtp({ purpose: "SIGNUP", email: "store6@otp.test", code: junk })).ok);
    const ok = await verifyOtp({ purpose: "SIGNUP", email: "store6@otp.test", code: ` ${issued.code.slice(0, 3)} ${issued.code.slice(3)} `, userId: "u_a" });
    assert.ok(ok.ok, "spaces in a typed code are fine");
  });

  // ---------------------------------------------------------------- sign-up
  await check("sign-up emails a code and a link, and the code confirms the address", async () => {
    assert.ok((await signUp({ companyName: "Code Co", name: "Code Admin", email: "admin@code-co.test", password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const mail = mails().filter((m) => m.to === "admin@code-co.test").at(-1)!;
    assert.match(mail.subject, /Confirm your email: your .* code is \d{3} \d{3}/);
    assert.match(mail.text, /token=[A-Za-z0-9_-]+/, "the link is still there");
    const [before] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='admin@code-co.test'`);
    assert.equal(before.emailVerifiedAt, null);
    const wrong = codeIn(mail) === "000000" ? "111111" : "000000";
    const bad = await confirmEmailWithCode("admin@code-co.test", wrong, { ip: ip() });
    assert.ok(!bad.ok);
    const [still] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='admin@code-co.test'`);
    assert.equal(still.emailVerifiedAt, null, "a wrong code confirms nothing");
    const good = await confirmEmailWithCode("ADMIN@code-co.test", codeIn(mail), { ip: ip() });
    assert.ok(good.ok, JSON.stringify(good));
    const [after] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='admin@code-co.test'`);
    assert.ok(after.emailVerifiedAt);
    assert.equal((await confirmEmailWithCode("admin@code-co.test", codeIn(mail), { ip: ip() })).ok, false, "a used code stays used");
    assert.equal((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(mail.text)![1])).ok, false, "the link from the same email is cancelled too");
  });

  await check("the link in the same email still works when the code is not used", async () => {
    assert.ok((await signUp({ companyName: "Link Co", name: "Link Admin", email: "admin@link-co.test", password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const mail = mails().filter((m) => m.to === "admin@link-co.test").at(-1)!;
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(mail.text)![1])).ok);
    const [row] = await q<{ emailVerifiedAt: Date | null }>(`SELECT "emailVerifiedAt" FROM "User" WHERE email='admin@link-co.test'`);
    assert.ok(row.emailVerifiedAt);
  });

  await check("asking for another confirmation code: a new one after 30 seconds, nothing new (and no hint) before", async () => {
    assert.ok((await signUp({ companyName: "Again Co", name: "Again Admin", email: "admin@again-co.test", password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const count = () => mails().filter((m) => m.to === "admin@again-co.test").length;
    assert.equal(count(), 1);
    const soon = await resendVerification("admin@again-co.test", { ip: ip() });
    assert.ok(soon.ok, "the answer is the same either way");
    assert.equal(count(), 1, "within 30 seconds nothing more is sent");
    await backdate("admin@again-co.test", "SIGNUP", 40);
    assert.ok((await resendVerification("admin@again-co.test", { ip: ip() })).ok);
    assert.equal(count(), 2);
    const newest = mails().filter((m) => m.to === "admin@again-co.test").at(-1)!;
    assert.ok((await confirmEmailWithCode("admin@again-co.test", codeIn(newest), { ip: ip() })).ok);
    // an address nobody registered gets the same answer and no email
    const ghost = await resendVerification("nobody@again-co.test", { ip: ip() });
    assert.ok(ghost.ok);
    assert.equal(mails().filter((m) => m.to === "nobody@again-co.test").length, 0);
  });

  // ---------------------------------------------------------------- password reset
  await check("password reset by code: weak password refused without using the code; then it works and signs everyone out", async () => {
    const email = "admin@code-co.test";
    const [before] = await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE email=$1`, [email]);
    assert.ok((await requestPasswordReset(email, { ip: ip() })).ok);
    const mail = mails().filter((m) => m.to === email && /Reset your .* password: your code is/.test(m.subject)).at(-1)!;
    assert.match(mail.text, /token=/, "the link is in the same email");
    const code = codeIn(mail);
    const weak = await resetPasswordWithCode({ email, code, password: "short" }, { ip: ip() });
    assert.ok(!weak.ok && weak.field === "password");
    const [tries] = await q<{ attempts: number; usedAt: Date | null }>(`SELECT attempts, "usedAt" FROM "OtpCode" WHERE email=$1 AND purpose='PASSWORD_RESET' ORDER BY "createdAt" DESC LIMIT 1`, [email]);
    assert.deepEqual([tries.attempts, tries.usedAt], [0, null], "a weak password did not use up the code or a try");
    const wrong = await resetPasswordWithCode({ email, code: code === "000000" ? "111111" : "000000", password: "A fresh passphrase 2026" }, { ip: ip() });
    assert.ok(!wrong.ok && wrong.field === "code");
    const done = await resetPasswordWithCode({ email, code, password: "A fresh passphrase 2026" }, { ip: ip() });
    assert.ok(done.ok, JSON.stringify(done));
    const [u] = await q<{ passwordHash: string; sessionVersion: number }>(`SELECT "passwordHash", "sessionVersion" FROM "User" WHERE email=$1`, [email]);
    assert.ok(await verifyPassword("A fresh passphrase 2026", u.passwordHash));
    assert.equal(u.sessionVersion, before.sessionVersion + 1);
    assert.ok(mails().some((m) => m.to === email && /password was changed/.test(m.subject)), "the person is told");
    assert.equal((await resetPasswordWithCode({ email, code, password: "Another passphrase 2026!" }, { ip: ip() })).ok, false, "the code works once");
  });

  await check("password reset by code gives the same answer for an address with no account", async () => {
    const r = await resetPasswordWithCode({ email: "ghost@code-co.test", code: "123456", password: "A fresh passphrase 2026" }, { ip: ip() });
    assert.ok(!r.ok && r.field === "code" && /not right, or it has expired/.test(r.error));
    assert.equal(mails().filter((m) => m.to === "ghost@code-co.test").length, 0);
  });

  // ---------------------------------------------------------------- confirm it is you
  const [person] = await q<{ id: string; email: string }>(`SELECT id, email FROM "User" WHERE email='admin@code-co.test'`);

  await check("a risky action needs a code; the right one lets it through and covers the next 15 minutes", async () => {
    const need = await checkStepUp(person.id, undefined);
    assert.ok(!need.ok && need.needsCode);
    const sent = await sendStepUpCode(person.id, "Close the company");
    assert.ok(sent.ok && /^a\*+@code-co\.test$/.test(sent.sentTo), JSON.stringify(sent));
    const mail = mails().filter((m) => m.to === person.email && /confirmation code is/.test(m.subject)).at(-1)!;
    assert.match(mail.text, /Close the company/);
    const wrong = await checkStepUp(person.id, codeIn(mail) === "000000" ? "111111" : "000000");
    assert.ok(!wrong.ok && wrong.needsCode);
    assert.equal(await recentlyConfirmed(person.id), false);
    const ok = await checkStepUp(person.id, codeIn(mail));
    assert.ok(ok.ok);
    assert.ok(await recentlyConfirmed(person.id));
    assert.ok((await checkStepUp(person.id, undefined)).ok, "no new code within 15 minutes");
    assert.ok((await checkStepUp(person.id, "")).ok);
  });

  await check("the 15 minutes end, and another person's confirmation does not count", async () => {
    await q(`UPDATE "OtpCode" SET "usedAt" = (now() AT TIME ZONE 'UTC') - interval '16 minutes' WHERE "userId"=$1 AND purpose='CONFIRM_ACTION'`, [person.id]);
    assert.equal(await recentlyConfirmed(person.id), false);
    const need = await checkStepUp(person.id, undefined);
    assert.ok(!need.ok && need.needsCode);
    const [other] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='admin@link-co.test'`);
    assert.equal(await recentlyConfirmed(other.id), false);
  });

  await check("asking for step-up codes is limited, and each code goes only to its owner's inbox", async () => {
    const [other] = await q<{ id: string; email: string }>(`SELECT id, email FROM "User" WHERE email='admin@link-co.test'`);
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      await q(`DELETE FROM "OtpCode" WHERE "userId"=$1 AND purpose='CONFIRM_ACTION'`, [other.id]); // skip the 30-second wait so the hourly limit is what is tested
      results.push((await sendStepUpCode(other.id, "Delete your account")).ok);
    }
    assert.equal(results.filter(Boolean).length, 8, "eight an hour");
    assert.ok(mails().filter((m) => m.to === other.email && /confirmation code is/.test(m.subject)).length >= 8);
    assert.equal(mails().filter((m) => m.to === person.email && /Delete your account/.test(m.text)).length, 0, "nothing went to someone else");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
