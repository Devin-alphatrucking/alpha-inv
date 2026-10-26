// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { checkGstin, cleanGstin, GST_STATES, gstinCheckChar, hasValue } from "./gstin";

/** A GSTIN with its correct check character, built from the first 14 characters. */
const make = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

// ---- the check character (published example numbers)
assert.equal(gstinCheckChar("27AAPFU0939F1Z"), "V", "27AAPFU0939F1ZV is the widely published example");
assert.equal(checkGstin("27AAPFU0939F1ZV").ok, true);
assert.equal(gstinCheckChar("short"), null);
assert.equal(gstinCheckChar("27aapfu0939f1z"), null, "capitals only");
assert.equal(gstinCheckChar("27AAPFU0939F1ZVX"), null);

// ---- valid numbers built with the scheme, in several states
for (const first14 of ["27AABCS1234F1Z", "29AABCS3456P1Z", "24AAACM9012L1Z", "07AAACG2115R1Z", "33ABCDE1234F2Z", "36AAAAA0000A1Z", "01AAAAA0000A1Z", "38AAAAA0000A1Z"]) {
  const r = checkGstin(make(first14));
  assert.ok(r.ok, first14);
}
assert.deepEqual(checkGstin(make("27AABCS1234F1Z")), { ok: true, state: "Maharashtra" });
assert.deepEqual(checkGstin(make("29AABCS3456P1Z")), { ok: true, state: "Karnataka" });

// ---- what people type: spaces, dashes, lower case
const good = make("27AABCS1234F1Z");
assert.equal(cleanGstin(` ${good.slice(0, 2)} ${good.slice(2, 7).toLowerCase()}-${good.slice(7)} `), good);
assert.equal(checkGstin(good.toLowerCase()).ok, true);
assert.equal(checkGstin(`${good.slice(0, 2)}-${good.slice(2, 12)}-${good.slice(12)}`).ok, true);

// ---- every kind of mistake is caught
const reason = (g: string | null | undefined) => {
  const r = checkGstin(g);
  assert.ok(!r.ok, `${g} should be refused`);
  return r.ok ? "" : r.reason;
};
assert.match(reason(""), /15 characters; this has 0/);
assert.match(reason(null), /15 characters/);
assert.match(reason(undefined), /15 characters/);
assert.match(reason("27AABCS1234F1Z"), /15 characters; this has 14/);
assert.match(reason(`${good}9`), /15 characters; this has 16/);
assert.match(reason("AAAABCS1234F1ZV"), /pattern/, "the first two must be digits");
assert.match(reason("2744BCS1234F1ZV"), /pattern/);
assert.match(reason("27AABCS12X4F1ZV"), /pattern/);
assert.match(reason("27AABCS1234F0ZV"), /pattern/, "the 13th character cannot be 0");
assert.match(reason("27AABCS1234F1AV"), /pattern/, "the 14th character is always Z");
assert.match(reason("27AABCS1234F1Z!"), /pattern/);
assert.match(reason(make("00AABCS1234F1Z")), /not a state code/);
assert.match(reason(make("25AABCS1234F1Z")), /not a state code/);
assert.match(reason(make("39AABCS1234F1Z")), /not a state code/);
// a wrong character at each position breaks the check character
for (let i = 0; i < 14; i++) {
  const swap = good[i] === "1" ? "2" : good[i] >= "0" && good[i] <= "9" ? "1" : good[i] === "A" ? "B" : "A";
  const wrong = good.slice(0, i) + swap + good.slice(i + 1);
  const r = checkGstin(wrong);
  // changing a character can also break the pattern; either way it must be refused
  assert.equal(r.ok, false, `position ${i + 1}`);
}
assert.match(reason(good.slice(0, 14) + (good[14] === "A" ? "B" : "A")), /last character/);
assert.match(reason("27AABCS1234F1Z5") === "" ? "x" : reason("27AABCS1234F1Z5"), /last character/, "the made-up number used in the demo data does not pass its check");

// ---- states
assert.equal(GST_STATES["27"], "Maharashtra");
assert.equal(Object.keys(GST_STATES).length, 38, "36 states and territories plus 97 and 99, with no 25 or 28");
assert.ok(!("25" in GST_STATES) && !("28" in GST_STATES));

// ---- has a value
assert.equal(hasValue(""), false);
assert.equal(hasValue("  - "), false);
assert.equal(hasValue(null), false);
assert.equal(hasValue("x"), true);

console.log("gstin: all checks passed");
