// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { canDeleteComment, cleanComment, COMMENT_MAX } from "./comment-rules";

const ok = (raw: unknown) => {
  const r = cleanComment(raw);
  assert.ok(r.ok, JSON.stringify(r));
  return r.body;
};
const bad = (raw: unknown) => {
  const r = cleanComment(raw);
  assert.ok(!r.ok);
  return r.error;
};
const ch = (code: number) => String.fromCharCode(code);

// ---- plain text passes through, trimmed
assert.equal(ok("Query raised with vendor"), "Query raised with vendor");
assert.equal(ok("  hello  "), "hello");
assert.equal(ok("Rs. 1,000 <b>not bold</b> & \"quoted\""), "Rs. 1,000 <b>not bold</b> & \"quoted\"", "html is kept as text (the page shows it as text, never as markup)");

// ---- empty is refused
assert.match(bad(""), /Write something/);
assert.match(bad("   \n\t  "), /Write something/);
assert.match(bad(undefined), /Write something/);
assert.match(bad(null), /Write something/);
assert.match(bad(42), /Write something/);

// ---- line endings and blank lines
assert.equal(ok("one\r\ntwo\rthree"), "one\ntwo\nthree");
assert.equal(ok("a\n\n\n\n\nb"), "a\n\nb", "many blank lines become one");
assert.equal(ok("a   \nb\t\nc"), "a\nb\nc", "trailing spaces dropped");
assert.equal(ok("a\n\nb"), "a\n\nb");

// ---- unsafe characters are removed
assert.equal(ok(`hi${ch(0)}${ch(7)}${ch(27)}there`), "hithere");
assert.equal(ok(`a${ch(0x200b)}b${ch(0x202e)}c${ch(0x2066)}d`), "abcd", "zero-width and direction marks removed");
assert.equal(ok(`tab${ch(9)}kept`), `tab${ch(9)}kept`, "a tab inside a line is fine");
assert.match(bad(`${ch(0)}${ch(0x200b)}  `), /Write something/, "nothing left after cleaning is empty");
assert.equal(ok("café ₹500 हिन्दी"), "café ₹500 हिन्दी", "other languages and symbols stay");

// ---- length counts characters, not bytes
assert.equal(ok("x".repeat(COMMENT_MAX)).length, COMMENT_MAX);
assert.match(bad("x".repeat(COMMENT_MAX + 1)), /under 2000/);
assert.ok(cleanComment("₹".repeat(COMMENT_MAX)).ok, "2000 rupee signs are 2000 characters");
assert.ok(!cleanComment("₹".repeat(COMMENT_MAX + 1)).ok);
assert.ok(cleanComment("😀".repeat(COMMENT_MAX)).ok, "an emoji is one character");

// ---- who may remove
const admin = { id: "a1", role: "ADMIN" as const };
const staff = { id: "s1", role: "STAFF" as const };
assert.ok(canDeleteComment(admin, { userId: "s1" }), "an administrator removes anyone's");
assert.ok(canDeleteComment(admin, { userId: null }), "and a former member's");
assert.ok(canDeleteComment(staff, { userId: "s1" }), "the author removes their own");
assert.ok(!canDeleteComment(staff, { userId: "s2" }), "not someone else's");
assert.ok(!canDeleteComment(staff, { userId: "a1" }), "not an administrator's");
assert.ok(!canDeleteComment(staff, { userId: null }), "not a former member's");

console.log("comment rules: all checks passed");
