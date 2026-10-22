// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { MIN_PASSWORD_LENGTH, checkPassword, hashPassword, verifyPassword } from "./password";
import { hashToken, newToken } from "./tokens";
import { clientIp, limitKey, retryMessage } from "./rate-limit";
import { esc, inviteMail, passwordResetMail, verifyEmailMail } from "../email/templates";
import { COUNTRY_DEFAULTS, RESERVED_SLUGS, STARTER_CATEGORIES, slugify, uniqueSlug } from "../org/starter-data";
import { acceptInviteSchema, inviteSchema, signUpSchema } from "../flows/schemas";

async function main() {
  // ---- passwords
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.match(checkPassword("short1")!, /at least 10/);
  assert.match(checkPassword("password123")!, /too common|at least/);
  assert.match(checkPassword("Password123".toLowerCase())!, /too common/);
  assert.match(checkPassword("aaaaaaaaaaaa")!, /repeated/);
  assert.match(checkPassword("x".repeat(80))!, /too long/);
  assert.match(checkPassword("daniel-is-here-2026", { email: "daniel@acme.test" })!, /email/);
  assert.equal(checkPassword("correct horse battery staple"), null);
  assert.equal(checkPassword("k9#Tq!vL2m"), null);
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(hash.startsWith("$2"));
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  assert.equal(await verifyPassword("anything", null), false, "unknown user never matches (but still costs a real comparison)");

  // ---- tokens: random, long, and only the hash is stored
  const a = newToken();
  const b = newToken();
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 43, "256 bits of randomness");
  assert.equal(a.hash, hashToken(a.token));
  assert.notEqual(a.hash, a.token);
  assert.match(a.token, /^[A-Za-z0-9_-]+$/, "safe inside a URL");

  // ---- rate limit helpers
  assert.equal(limitKey("login:email", "A@x.test"), limitKey("login:email", " a@x.test "), "case and spaces do not create a second bucket");
  assert.ok(!limitKey("login:email", "a@x.test").includes("a@x.test"), "addresses are not stored");
  assert.equal(clientIp({ get: (n: string) => (n === "x-forwarded-for" ? "203.0.113.9, 10.0.0.1" : null) }), "203.0.113.9");
  assert.equal(clientIp({ get: () => null }), "unknown");
  assert.match(retryMessage(30), /a minute/);
  assert.match(retryMessage(600), /10 minutes/);

  // ---- email templates escape everything that comes from users
  assert.equal(esc(`<script>alert("x")&'`), "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;");
  const evil = '<img src=x onerror=alert(1)>';
  const mail = inviteMail("to@x.test", { inviterName: evil, company: evil, role: "STAFF", link: "https://app.test/accept-invite?token=abc", brand: { name: evil, color: "red;}</style>" } });
  assert.ok(!mail.html.includes(evil), "no raw markup from names");
  assert.ok(!mail.html.includes("red;}"), "an invalid brand colour is never used");
  assert.ok(mail.text.includes("https://app.test/accept-invite?token=abc"));
  assert.ok(verifyEmailMail("a@x.test", { name: "Ann", link: "https://app.test/v?token=t", brand: { name: "Acme", color: "#0F4C81" } }).html.includes("#0F4C81"));
  assert.match(passwordResetMail("a@x.test", { name: "Ann", link: "https://app.test/r", brand: { name: "Acme" } }).text, /1 hour/);

  // ---- company codes and defaults
  assert.equal(slugify("Acme Builders Pty Ltd"), "acme-builders-pty-ltd");
  assert.equal(slugify("  Café & Sons!! "), "cafe-and-sons");
  assert.equal(slugify("x"), "company");
  assert.equal(slugify("日本"), "company");
  assert.ok(slugify("A".repeat(80)).length <= 30);
  const taken = new Set(["acme", "acme-2"]);
  assert.equal(await uniqueSlug("Acme", async (s) => taken.has(s)), "acme-3");
  assert.notEqual(await uniqueSlug("Admin", async () => false), "admin", "reserved words are never used");
  assert.ok(RESERVED_SLUGS.has("api") && RESERVED_SLUGS.has("login"));
  assert.equal(COUNTRY_DEFAULTS.AU.currency, "AUD");
  assert.ok(STARTER_CATEGORIES.length >= 5 && new Set(STARTER_CATEGORIES.map((c) => c.name)).size === STARTER_CATEGORIES.length);

  // ---- form schemas
  const good = { companyName: "Acme Builders", name: "Ann Lee", email: "ANN@Acme.TEST ", password: "correct horse battery", country: "AU", acceptTerms: true };
  const ok = signUpSchema.safeParse(good);
  assert.ok(ok.success && ok.data.email === "ann@acme.test");
  for (const bad of [
    { companyName: "A" }, { name: "" }, { email: "nope" }, { password: "short" }, { country: "XX" },
    { acceptTerms: false }, { password: "annabel-rocks-1", email: "annabel@acme.test" },
  ]) assert.equal(signUpSchema.safeParse({ ...good, ...bad }).success, false, JSON.stringify(bad));
  assert.equal(inviteSchema.safeParse({ email: "b@x.test", role: "OWNER", projectIds: [] }).success, false, "only ADMIN or STAFF can be invited");
  assert.ok(inviteSchema.safeParse({ email: "B@X.test", role: "STAFF" }).success);
  assert.equal(acceptInviteSchema.safeParse({ token: "short" }).success, false);

  console.log("security: all checks passed");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
