// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { cleanCode, codesMatch, displayCode, failureMessage, generateCode, hashCode, OTP_LENGTH, OTP_MAX_TRIES, OTP_RESEND_SECONDS, OTP_TTL_MS, STEP_UP_WINDOW_MS } from "./otp-rules";

// ---- the numbers that define the rules
assert.equal(OTP_LENGTH, 6);
assert.equal(OTP_TTL_MS, 10 * 60 * 1000);
assert.equal(OTP_MAX_TRIES, 5);
assert.equal(OTP_RESEND_SECONDS, 30);
assert.equal(STEP_UP_WINDOW_MS, 15 * 60 * 1000);

// ---- generating
const seen = new Set<string>();
let leadingZero = 0;
for (let i = 0; i < 4000; i++) {
  const c = generateCode();
  assert.match(c, /^\d{6}$/, `six digits: ${c}`);
  if (c.startsWith("0")) leadingZero++;
  seen.add(c);
}
assert.ok(seen.size > 3900, "codes are not repeating (random, not a counter)");
assert.ok(leadingZero > 200 && leadingZero < 650, `about one in ten starts with 0, so leading zeros are kept (${leadingZero})`);

// ---- reading what was typed
assert.equal(cleanCode("123456"), "123456");
assert.equal(cleanCode(" 123 456 "), "123456");
assert.equal(cleanCode("123-456"), "123456");
assert.equal(cleanCode("000123"), "000123", "leading zeros are kept");
for (const bad of ["", "12345", "1234567", "12345a", "abcdef", "12 34", null, undefined, 123456, {}, "١٢٣٤٥٦"]) assert.equal(cleanCode(bad), null, String(bad));

// ---- hashing
const h = hashCode("secret", "id1", "SIGNUP", "a@b.test", "123456");
assert.match(h, /^[0-9a-f]{64}$/);
assert.equal(h, hashCode("secret", "id1", "SIGNUP", " A@B.test ", "123456"), "the address is normalised");
for (const other of [
  hashCode("other-secret", "id1", "SIGNUP", "a@b.test", "123456"),
  hashCode("secret", "id2", "SIGNUP", "a@b.test", "123456"),
  hashCode("secret", "id1", "PASSWORD_RESET", "a@b.test", "123456"),
  hashCode("secret", "id1", "SIGNUP", "c@b.test", "123456"),
  hashCode("secret", "id1", "SIGNUP", "a@b.test", "123457"),
]) assert.notEqual(h, other, "any change to secret, id, purpose, address or code changes the hash");
assert.ok(codesMatch(h, h));
assert.ok(!codesMatch(h, hashCode("secret", "id1", "SIGNUP", "a@b.test", "000000")));
assert.ok(!codesMatch(h, "zz"), "a damaged value never matches");
assert.ok(!codesMatch("", ""), "an empty hash never matches");

// ---- showing it
assert.equal(displayCode("123456"), "123 456");
assert.equal(displayCode("000042"), "000 042");

// ---- messages
assert.match(failureMessage("wrong", 3), /3 tries left/);
assert.match(failureMessage("wrong", 1), /1 try left/);
assert.match(failureMessage("wrong", 0), /Ask for a new code/);
assert.match(failureMessage("locked"), /Too many wrong codes/);
assert.match(failureMessage("expired"), /expired/);
assert.match(failureMessage("none"), /not right, or it has expired/);
assert.ok(!failureMessage("none").includes("account"), "nothing about whether an account exists");

console.log("otp rules: all checks passed");
