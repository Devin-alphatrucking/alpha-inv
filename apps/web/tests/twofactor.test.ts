// Database-backed tests of two-step sign-in. Run through `npm run test:isolation`.
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

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 120;
const ip = () => `198.19.0.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const tf = await import("@/lib/flows/two-factor");
  const m = await import("@/lib/mobile/sessions");
  const { totpAt, stepOf } = await import("@/lib/security/totp");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];
  const count = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);

  const PW = "correct horse battery staple";
  const makeUser = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [u] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    return { id: u.id, email };
  };
  const reset = () => q(`DELETE FROM "RateLimit"`);
  const login = async (email: string, extra: Record<string, unknown> = {}, password = PW) => {
    await reset();
    return m.loginMobile({ email, password, platform: "android", ...extra }, { ip: ip() });
  };
  /**
   * A code that is valid right now. Tests cannot wait 30 seconds between sign-ins, so this first rewinds "the last step accepted"
   * to before the current window (the same as time having passed). Tests of replay do NOT call it again between the two attempts.
   */
  const freshCode = async (secret: string, userId: string) => {
    const now = new Date();
    await q(`UPDATE "User" SET "totpLastStep" = $2 WHERE id=$1`, [userId, stepOf(now) - 3]);
    return { code: totpAt(secret, now), at: now };
  };

  const alice = await makeUser("TwoStep Alice", "alice@twostep.test");
  const bob = await makeUser("TwoStep Bob", "bob@twostep.test");

  let secret = "";
  let recovery: string[] = [];

  await check("without two-step on, sign-in needs only the password", async () => {
    assert.equal((await login(alice.email)).ok, true);
    const s = await tf.twoFactorStatus(alice.id);
    assert.deepEqual([s.enabled, s.recoveryLeft], [false, 0]);
  });

  await check("setup: the secret is stored ENCRYPTED, and does not count until confirmed", async () => {
    const r = await tf.beginTwoFactorSetup(alice.id);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    secret = r.secret;
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.match(r.uri, /^otpauth:\/\/totp\//);
    const [row] = await q<{ totpSecretEnc: string; totpEnabledAt: Date | null }>(`SELECT "totpSecretEnc", "totpEnabledAt" FROM "User" WHERE id=$1`, [alice.id]);
    assert.ok(row.totpSecretEnc && !row.totpSecretEnc.includes(secret), "the secret is not stored in readable form");
    assert.equal(row.totpEnabledAt, null);
    assert.equal((await login(alice.email)).ok, true, "still password-only until confirmed");
  });

  await check("setup: a wrong code is refused; the right code turns it on and gives 8 single-use recovery codes (stored hashed)", async () => {
    await reset();
    const bad = await tf.confirmTwoFactorSetup(alice.id, "000000");
    assert.equal(bad.ok, false);
    const { code } = await freshCode(secret, alice.id);
    const ok = await tf.confirmTwoFactorSetup(alice.id, code);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    recovery = ok.recoveryCodes;
    assert.equal(recovery.length, 8);
    assert.equal(await count(`SELECT count(*) n FROM "RecoveryCode" WHERE "userId"=$1 AND "usedAt" IS NULL`, [alice.id]), 8);
    const hashes = (await q<{ codeHash: string }>(`SELECT "codeHash" FROM "RecoveryCode" WHERE "userId"=$1`, [alice.id])).map((r) => r.codeHash);
    assert.ok(recovery.every((c) => !hashes.includes(c)), "only hashes are stored");
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='TWO_STEP_ENABLED' AND "userId"=$1`, [alice.id]), 1);
    const again = await tf.beginTwoFactorSetup(alice.id);
    assert.equal(again.ok, false, "cannot start a second setup while on");
  });

  await check("sign-in: a right password without a code is told to enter the code; a WRONG password never reveals that two-step is on", async () => {
    const noCode = await login(alice.email);
    assert.equal(noCode.ok === false && noCode.code, "totp_required");
    const wrongPw = await login(alice.email, {}, "wrong password here");
    assert.equal(wrongPw.ok === false && wrongPw.code, "invalid_credentials");
    const unknown = await login("nobody@twostep.test");
    assert.equal(unknown.ok === false && unknown.code, "invalid_credentials");
  });

  await check("sign-in: a wrong code is refused, the right code works, and the same code cannot be used twice", async () => {
    const bad = await login(alice.email, { totp: "123456" });
    assert.equal(bad.ok === false && bad.code, "totp_invalid");
    const { code } = await freshCode(secret, alice.id);
    const good = await login(alice.email, { totp: code });
    assert.equal(good.ok, true, JSON.stringify(good));
    const replay = await login(alice.email, { totp: code });
    assert.equal(replay.ok === false && replay.code, "totp_invalid", "a used code is dead");
  });

  await check("sign-in: a recovery code works once, is used up, and is logged", async () => {
    const code = recovery[0].toLowerCase().replace("-", " "); // typed sloppily
    const first = await login(alice.email, { totp: code });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await login(alice.email, { totp: recovery[0] });
    assert.equal(second.ok === false && second.code, "totp_invalid");
    assert.equal(await count(`SELECT count(*) n FROM "RecoveryCode" WHERE "userId"=$1 AND "usedAt" IS NULL`, [alice.id]), 7);
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='RECOVERY_CODE_USED' AND "userId"=$1`, [alice.id]), 1);
    assert.equal((await tf.twoFactorStatus(alice.id)).recoveryLeft, 7);
  });

  await check("guessing codes is limited: after 10 wrong tries even the right code waits", async () => {
    await reset();
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await m.loginMobile({ email: alice.email, password: PW, totp: "000000" }, { ip: ip() });
      if (!r.ok && r.code === "rate_limited") limited = true;
    }
    assert.ok(limited, "expected a rate limit");
    const { code } = await freshCode(secret, alice.id);
    const r = await m.loginMobile({ email: alice.email, password: PW, totp: code }, { ip: ip() });
    assert.equal(r.ok, false);
    await reset();
  });

  await check("two simultaneous sign-ins with the same fresh code: only one succeeds", async () => {
    await reset();
    const { code } = await freshCode(secret, alice.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => m.loginMobile({ email: alice.email, password: PW, totp: code }, { ip: ip() })));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.ok || (r as { code: string }).code)));
    await reset();
  });

  await check("turning it off needs the password AND a code; new recovery codes replace the old ones", async () => {
    await reset();
    const wrongPw = await tf.disableTwoFactor(alice.id, "not my password", "123456");
    assert.equal(wrongPw.ok, false);
    let c = await freshCode(secret, alice.id);
    const wrongCode = await tf.disableTwoFactor(alice.id, PW, "999999");
    assert.equal(wrongCode.ok, false);
    assert.equal((await tf.twoFactorStatus(alice.id)).enabled, true, "still on after refusals");

    c = await freshCode(secret, alice.id);
    const regen = await tf.regenerateRecoveryCodes(alice.id, PW, c.code);
    assert.equal(regen.ok, true);
    if (!regen.ok) return;
    assert.equal(regen.recoveryCodes.length, 8);
    assert.notEqual(regen.recoveryCodes[0], recovery[1]);
    await reset();
    const old = await m.loginMobile({ email: alice.email, password: PW, totp: recovery[1] }, { ip: ip() });
    assert.equal(old.ok === false && old.code, "totp_invalid", "an old recovery code stopped working");

    await reset();
    c = await freshCode(secret, alice.id);
    // the code used above is spent; the next step is needed for another confirmation
    const off = await tf.disableTwoFactor(alice.id, PW, regen.recoveryCodes[0]); // a recovery code is accepted here too
    assert.equal(off.ok, true, JSON.stringify(off));
    const s = await tf.twoFactorStatus(alice.id);
    assert.deepEqual([s.enabled, s.recoveryLeft], [false, 0]);
    assert.equal(await count(`SELECT count(*) n FROM "RecoveryCode" WHERE "userId"=$1`, [alice.id]), 0);
    const [row] = await q<{ totpSecretEnc: string | null }>(`SELECT "totpSecretEnc" FROM "User" WHERE id=$1`, [alice.id]);
    assert.equal(row.totpSecretEnc, null);
    assert.equal((await login(alice.email)).ok, true, "password-only again");
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='TWO_STEP_DISABLED' AND "userId"=$1`, [alice.id]), 1);
  });

  await check("one person's code never works for another account", async () => {
    const r = await tf.beginTwoFactorSetup(bob.id);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { code } = await freshCode(r.secret, bob.id);
    assert.equal((await tf.confirmTwoFactorSetup(bob.id, code)).ok, true);
    // a fresh code for Bob's secret, presented for Alice (two-step now off) or a different secret
    assert.equal((await tf.checkSecondFactor(alice.id, code)).ok, false);
    await reset();
    const other = await tf.beginTwoFactorSetup(alice.id);
    assert.equal(other.ok, true);
    if (!other.ok) return;
    const bobNext = totpAt(r.secret, new Date(Date.now() + 30_000));
    assert.equal((await tf.confirmTwoFactorSetup(alice.id, bobNext)).ok, false, "Bob's code does not confirm Alice's secret");
  });

  await check("an unconfirmed setup can be restarted with a new secret, and the old secret stops working", async () => {
    await reset();
    const first = await tf.beginTwoFactorSetup(alice.id);
    const second = await tf.beginTwoFactorSetup(alice.id);
    assert.ok(first.ok && second.ok);
    if (!first.ok || !second.ok) return;
    assert.notEqual(first.secret, second.secret);
    const oldCode = totpAt(first.secret, new Date());
    const newCode = totpAt(second.secret, new Date());
    assert.notEqual(oldCode, newCode);
    assert.equal((await tf.confirmTwoFactorSetup(alice.id, oldCode)).ok, false, "the first secret no longer confirms");
    await reset();
    assert.equal((await tf.confirmTwoFactorSetup(alice.id, newCode)).ok, true, "the newest one does");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
