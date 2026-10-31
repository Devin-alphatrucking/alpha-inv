// Database-backed tests of the phone app's sign-up, password-reset and Google sign-in (the /api/v1/auth routes).
// Run through `npm run test:isolation` (real PostgreSQL, the ordinary app role, EMAIL_TRANSPORT=file).
import assert from "node:assert/strict";
import fs from "node:fs";

const emailFile = process.env.EMAIL_FILE;
if (!emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
process.env.GOOGLE_MOBILE_CLIENT_IDS = "android-id.apps.test, ios-id.apps.test";

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

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail) : []).filter((m) => m.to === email);
/** The newest 6-digit code emailed to an address ("123 456" in the text). */
const lastCode = (email: string, subjectPart: string) => {
  const mails = mailsTo(email).filter((m) => m.subject.includes(subjectPart));
  assert.ok(mails.length > 0, `no "${subjectPart}" email to ${email}`);
  const m = /(\d{3}) (\d{3})/.exec(mails[mails.length - 1].text);
  assert.ok(m, "the email carries a 6-digit code");
  return `${m[1]}${m[2]}`;
};

let ipCounter = 0;
const ip = () => `203.0.113.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmailWithCode, requestPasswordReset, resetPasswordWithCode } = await import("@/lib/flows/verify-reset");
  const { loginMobile, authenticateBearer } = await import("@/lib/mobile/sessions");
  const { googleLoginMobile } = await import("@/lib/mobile/google");
  const { rawDb } = await import("@/lib/db");

  const PW = "correct horse battery staple";
  const base = { companyName: "Phone Builders", name: "Pia Phone", email: "pia@phone-builders.test", password: PW, country: "IN", phone: "98765 43210", acceptTerms: true };

  await check("phone sign-up: sign up, confirm with the emailed code, then sign in with the same password", async () => {
    assert.deepEqual(await signUp(base, { ip: ip() }), { ok: true, checkEmail: true });
    const early = await loginMobile({ email: base.email, password: PW }, { ip: ip() });
    assert.ok(!early.ok && early.code === "email_not_verified", "cannot sign in before confirming");
    const wrong = await confirmEmailWithCode(base.email, "000000", { ip: ip() });
    assert.equal(wrong.ok, false);
    const done = await confirmEmailWithCode(base.email, lastCode(base.email, "Confirm your email"), { ip: ip() });
    assert.equal(done.ok, true);
    const r = await loginMobile({ email: base.email, password: PW, platform: "android" }, { ip: ip() });
    assert.ok(r.ok);
    if (r.ok) assert.ok(await authenticateBearer(r.tokens.accessToken), "the new session works");
  });

  await check("phone sign-up: a number that is not Indian is refused with a clear message for the phone field", async () => {
    const r = await signUp({ ...base, email: "bad@phone-builders.test", companyName: "Bad Phone Co", phone: "12345" }, { ip: ip() });
    assert.ok(!r.ok && r.field === "phone");
  });

  await check("phone password reset: a code is emailed and sets a new password; the old one stops working", async () => {
    const asked = await requestPasswordReset(base.email, { ip: ip() });
    assert.ok(asked.ok);
    const NEW = "a brand new passphrase 4711";
    const reset = await resetPasswordWithCode({ email: base.email, code: lastCode(base.email, "eset"), password: NEW }, { ip: ip() });
    assert.equal(reset.ok, true);
    assert.ok(!(await loginMobile({ email: base.email, password: PW }, { ip: ip() })).ok);
    assert.ok((await loginMobile({ email: base.email, password: NEW }, { ip: ip() })).ok);
  });

  // ---- Google: Google's check is replaced by a stand-in so the test needs no internet.
  const realFetch = globalThis.fetch;
  const tokenInfo: Record<string, { aud: string; iss?: string; exp?: string; email: string; email_verified: string; name?: string }> = {};
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const id = new URL(url).searchParams.get("id_token") ?? "";
      const info = tokenInfo[id];
      return info ? new Response(JSON.stringify({ iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 600), ...info }), { status: 200 }) : new Response("{}", { status: 400 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const tok = (name: string) => `${name}-`.padEnd(30, "x");

  try {
    await check("google on the phone: a new person gets a company on a free trial and a working session", async () => {
      tokenInfo[tok("new")] = { aud: "android-id.apps.test", email: "gina@gmail-test.example", email_verified: "true", name: "Gina Google" };
      const r = await googleLoginMobile({ idToken: tok("new"), platform: "android" }, { ip: ip() });
      assert.ok(r.ok, r.ok ? "" : r.error);
      if (!r.ok) return;
      assert.equal(r.created, true);
      const me = await authenticateBearer(r.tokens.accessToken);
      assert.equal(me?.email, "gina@gmail-test.example");
      const [org] = await rawDb.$queryRaw<{ status: string }[]>`SELECT o.status FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id WHERE m."userId"=${me!.id}`;
      assert.equal(org.status, "TRIAL");
    });

    await check("google on the phone: the same person signing in again gets the same account, not a second company", async () => {
      const before = await rawDb.user.count();
      const r = await googleLoginMobile({ idToken: tok("new") }, { ip: ip() });
      assert.ok(r.ok && r.created === false);
      assert.equal(await rawDb.user.count(), before);
    });

    await check("google on the phone: a token meant for another app, an unconfirmed address, or one Google does not know is refused", async () => {
      tokenInfo[tok("other")] = { aud: "someone-elses-app.apps.test", email: "x@gmail-test.example", email_verified: "true" };
      tokenInfo[tok("unverified")] = { aud: "ios-id.apps.test", email: "y@gmail-test.example", email_verified: "false" };
      tokenInfo[tok("expired")] = { aud: "ios-id.apps.test", email: "z@gmail-test.example", email_verified: "true", exp: "1000" };
      for (const name of ["other", "unverified", "expired", "unknown"]) {
        const r = await googleLoginMobile({ idToken: tok(name) }, { ip: ip() });
        assert.ok(!r.ok, name);
      }
      assert.equal(await rawDb.user.count({ where: { email: { in: ["x@gmail-test.example", "y@gmail-test.example", "z@gmail-test.example"] } } }), 0, "no account was created");
    });

    await check("google on the phone: someone with two-step sign-in must use their password and code", async () => {
      const pia = await rawDb.user.findUniqueOrThrow({ where: { email: base.email } });
      await rawDb.user.update({ where: { id: pia.id }, data: { totpEnabledAt: new Date() } });
      tokenInfo[tok("pia")] = { aud: "android-id.apps.test", email: base.email, email_verified: "true" };
      const r = await googleLoginMobile({ idToken: tok("pia") }, { ip: ip() });
      assert.ok(!r.ok && r.code === "google_two_step");
      await rawDb.user.update({ where: { id: pia.id }, data: { totpEnabledAt: null } });
    });

    await check("google on the phone: a server without Google client ids says so instead of trusting any token", async () => {
      const saved = process.env.GOOGLE_MOBILE_CLIENT_IDS;
      const savedWeb = process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_MOBILE_CLIENT_IDS = "";
      delete process.env.GOOGLE_CLIENT_ID;
      const r = await googleLoginMobile({ idToken: tok("new") }, { ip: ip() });
      assert.ok(!r.ok && r.code === "google_off");
      process.env.GOOGLE_MOBILE_CLIENT_IDS = saved;
      if (savedWeb) process.env.GOOGLE_CLIENT_ID = savedWeb;
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
