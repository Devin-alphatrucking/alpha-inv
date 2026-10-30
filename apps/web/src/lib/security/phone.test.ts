import assert from "node:assert/strict";
import { DIAL_CODES, formatPhone, normalizePhone, PHONE_EXAMPLE, phoneHint } from "./phone";

const ok = (raw: unknown, country?: string) => {
  const r = normalizePhone(raw, country);
  assert.ok(r.ok, `${String(raw)} -> ${JSON.stringify(r)}`);
  return r.phone;
};
const bad = (raw: unknown, country?: string) => assert.equal(normalizePhone(raw, country).ok, false, String(raw));

// India, the way people write it
for (const raw of ["9876543210", "98765 43210", "98765-43210", "09876543210", "+91 98765 43210", "+91-98765-43210", "0091 98765 43210", "(098) 765-43210", "919876543210", " 9876543210 "]) {
  assert.equal(ok(raw), "+919876543210", raw);
}
bad("1234567890"); // starts with 1: not an Indian mobile
bad("98765 4321"); // 9 digits
bad("98765432101"); // 11 digits
bad("+91 5876543210");

// Other countries, with and without the + (the company's country is the default)
assert.equal(ok("0412 345 678", "AU"), "+61412345678");
assert.equal(ok("+61 412 345 678", "AU"), "+61412345678");
assert.equal(ok("+44 7911 123456"), "+447911123456", "a + number is taken as it is whatever the default country");
assert.equal(ok("(415) 555-2671", "US"), "+14155552671");
assert.equal(ok("050 123 4567", "AE"), "+971501234567");

// Rubbish and edge cases
for (const raw of ["", "   ", "abc", "98765 4321a", "++919876543210", 9876543210, null, undefined, {}, "+", "0000000000", "+0123456789", "1".repeat(31), "+1234567"]) bad(raw);
assert.ok(normalizePhone("123", "IN").ok === false);
assert.equal(normalizePhone("98765x", "IN").ok, false);
assert.match((normalizePhone("abc") as { error: string }).error, /digits/);

// Showing
assert.equal(formatPhone("+919876543210"), "+91 98765 43210");
assert.equal(formatPhone("+61412345678"), "+61412345678");
assert.equal(formatPhone(null), "");

// The sign-up form's example and help follow the chosen country, and every example is accepted for its own country.
assert.match(phoneHint("IN"), /Indian mobile/);
assert.match(phoneHint("AU"), /\+61/);
for (const country of Object.keys(DIAL_CODES)) assert.ok(normalizePhone(PHONE_EXAMPLE[country], country).ok, `example number for ${country}`);

console.log("phone: all checks passed");
