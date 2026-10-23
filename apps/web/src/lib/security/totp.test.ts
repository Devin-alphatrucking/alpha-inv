// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { base32Decode, base32Encode, generateSecret, hashRecoveryCode, newRecoveryCodes, normalizeRecoveryCode, otpauthUri, totpAt, verifyTotp } from "./totp";

// ---- RFC 6238 test values (secret "12345678901234567890", SHA-1; the RFC lists 8-digit codes, we use the last 6 digits too)
const secret = base32Encode(Buffer.from("12345678901234567890"));
assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
const at = (s: number) => new Date(s * 1000);
assert.equal(totpAt(secret, at(59), 8), "94287082");
assert.equal(totpAt(secret, at(1111111109), 8), "07081804");
assert.equal(totpAt(secret, at(1111111111), 8), "14050471");
assert.equal(totpAt(secret, at(1234567890), 8), "89005924");
assert.equal(totpAt(secret, at(2000000000), 8), "69279037");
assert.equal(totpAt(secret, at(20000000000), 8), "65353130");
assert.equal(totpAt(secret, at(59)), "287082");

// ---- base32
assert.equal(base32Decode(secret).toString(), "12345678901234567890");
assert.equal(base32Decode("gezd gnbv-gy3t qojq====").toString(), "1234567890", "spaces, dashes, padding and case are ignored");
assert.throws(() => base32Decode("not valid 1"), /Invalid base32/);
const s1 = generateSecret();
assert.match(s1, /^[A-Z2-7]{32}$/);
assert.notEqual(s1, generateSecret());
assert.equal(base32Encode(base32Decode(s1)), s1);

// ---- verifying
const now = at(1_800_000_000);
const good = totpAt(secret, now);
assert.notEqual(verifyTotp(secret, good, now), null);
assert.notEqual(verifyTotp(secret, ` ${good.slice(0, 3)} ${good.slice(3)} `, now), null, "spaces are fine");
assert.notEqual(verifyTotp(secret, totpAt(secret, at(1_800_000_000 - 30)), now), null, "one step old is accepted (clock drift)");
assert.notEqual(verifyTotp(secret, totpAt(secret, at(1_800_000_000 + 30)), now), null, "one step ahead is accepted");
assert.equal(verifyTotp(secret, totpAt(secret, at(1_800_000_000 - 90)), now), null, "three steps old is not");
assert.equal(verifyTotp(secret, totpAt(secret, at(1_800_000_000 + 90)), now), null);
for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5x", null as unknown as string, undefined as unknown as string]) {
  assert.equal(verifyTotp(secret, bad, now), null, String(bad));
}
assert.equal(verifyTotp("not base32!", good, now), null, "a broken secret never throws");
const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, "0");
assert.equal(verifyTotp(secret, wrong, now), null);

// one use only
const step = verifyTotp(secret, good, now)!;
assert.equal(verifyTotp(secret, good, now, step), null, "the same code cannot be used twice");
assert.equal(verifyTotp(secret, totpAt(secret, at(1_800_000_000 - 30)), now, step), null, "an older step than the last one used is refused");
assert.notEqual(verifyTotp(secret, totpAt(secret, at(1_800_000_000 + 30)), now, step), null, "a newer step is fine");

// ---- app link
const uri = otpauthUri("Invoice & Billing", "ravi@example.com", secret);
assert.match(uri, /^otpauth:\/\/totp\/Invoice%20%26%20Billing:ravi%40example\.com\?secret=GEZ/);
assert.match(uri, /issuer=Invoice%20%26%20Billing/);
assert.match(uri, /digits=6&period=30/);

// ---- recovery codes
const codes = newRecoveryCodes();
assert.equal(codes.length, 8);
assert.equal(new Set(codes).size, 8);
for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
assert.equal(normalizeRecoveryCode(codes[0].toLowerCase().replace("-", " ")), codes[0], "typed in lower case with a space");
assert.equal(normalizeRecoveryCode(codes[0].replace("-", "")), codes[0]);
for (const bad of ["", "abc", "ABCDE-FGHI", "ABCDE-FGHIJK", null as unknown as string]) assert.equal(normalizeRecoveryCode(bad), null, String(bad));
assert.match(hashRecoveryCode(codes[0]), /^[0-9a-f]{64}$/);
assert.notEqual(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[1]));

console.log("totp: all checks passed");
