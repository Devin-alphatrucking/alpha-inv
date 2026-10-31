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

  // ---- Accounts on the phone: vendors, an invoice with its payments, and the payments list, through the real route handlers.
  const call = async (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, token: string, init: { method?: string; body?: unknown; params?: Record<string, string>; query?: string } = {}) => {
    const req = new Request(`http://app.test/api${init.query ?? ""}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  await check("phone accounts: vendors, invoice detail with payments, recording a payment, and the payments list", async () => {
    const vendorsRoute = await import("@/app/api/v1/vendors/route");
    const vendorRoute = await import("@/app/api/v1/vendors/[id]/route");
    const invoiceRoute = await import("@/app/api/v1/invoices/[id]/route");
    const payRoute = await import("@/app/api/v1/invoices/[id]/payments/route");
    const paymentsRoute = await import("@/app/api/v1/payments/route");
    const { dbFor } = await import("@/lib/org/scoped-db");

    const login = await loginMobile({ email: base.email, password: "a brand new passphrase 4711" }, { ip: ip() });
    assert.ok(login.ok);
    if (!login.ok) return;
    const token = login.tokens.accessToken;
    const db = dbFor(login.orgId);
    const [project] = await db.project.findMany({ take: 1 });
    const vendor = await db.vendor.create({ data: { organizationId: login.orgId, name: "Shree Cement Traders", gstin: "27ABCDE1234F1Z5" } });
    const invoice = await db.invoice.create({
      data: { organizationId: login.orgId, invoiceNumber: "INV-100", projectId: project.id, vendorId: vendor.id, invoiceDate: new Date("2026-10-01T00:00:00Z"), dueDate: new Date("2026-12-01T00:00:00Z"), subtotal: 1000, total: 1000, status: "UNPAID", fileUrl: "x" },
    });

    const vendors = await call(vendorsRoute.GET as never, token);
    assert.equal(vendors.status, 200);
    assert.ok((vendors.body.vendors as { name: string; invoiceCount: number }[]).some((v) => v.name === "Shree Cement Traders" && v.invoiceCount === 1));
    const found = await call(vendorsRoute.GET as never, token, { query: "?q=27ABCDE" });
    assert.equal((found.body.vendors as unknown[]).length, 1);
    const one = await call(vendorRoute.GET as never, token, { params: { id: vendor.id } });
    assert.equal(one.body.totals.billed, "1000.00");
    assert.equal(one.body.totals.owed, "1000.00");

    const detail = await call(invoiceRoute.GET as never, token, { params: { id: invoice.id } });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.canPay, true);
    assert.equal(detail.body.balance, "1000.00");

    const tooMuch = await call(payRoute.POST as never, token, { method: "POST", params: { id: invoice.id }, body: { amount: 5000, paidOn: "2026-11-02" } });
    assert.ok(tooMuch.status >= 400, "a payment above the balance is refused");
    const part = await call(payRoute.POST as never, token, { method: "POST", params: { id: invoice.id }, body: { amount: 400, paidOn: "2026-11-02", mode: "UPI", reference: "UTR1" } });
    assert.equal(part.status, 201);
    assert.equal(part.body.status, "PARTIALLY_PAID");
    assert.equal(part.body.balance, "600.00");

    const after = await call(invoiceRoute.GET as never, token, { params: { id: invoice.id } });
    assert.equal(after.body.paid, "400.00");
    assert.equal((after.body.invoice.payments as unknown[]).length, 1);

    const list = await call(paymentsRoute.GET as never, token);
    assert.equal(list.status, 200);
    assert.equal(list.body.totals.paid, "400.00");
    assert.equal(list.body.totals.outstanding, "600.00");
    assert.equal((list.body.payments as { invoice: { invoiceNumber: string } }[])[0].invoice.invoiceNumber, "INV-100");
  });

  await check("phone accounts: no token, or a role without the permission, gets a refusal", async () => {
    const vendorsRoute = await import("@/app/api/v1/vendors/route");
    const paymentsRoute = await import("@/app/api/v1/payments/route");
    const none = await vendorsRoute.GET(new Request("http://app.test/api"), { params: Promise.resolve({}) } as never);
    assert.equal(none.status, 401);
    const noneToo = await paymentsRoute.GET(new Request("http://app.test/api"), { params: Promise.resolve({}) } as never);
    assert.equal(noneToo.status, 401);
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
