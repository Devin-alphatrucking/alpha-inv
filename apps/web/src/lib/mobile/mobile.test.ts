// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { bearerFrom, hashRefresh, newRefreshToken, signAccessToken, verifyAccessToken } from "./token";

process.env.AUTH_SECRET = "unit-test-secret-value";
const now = new Date("2026-11-01T12:00:00Z");

// ---- access tokens
const { token, expiresAt } = signAccessToken("sess_1", now);
assert.match(token, /^v1\.[\w-]+\.[\w-]+$/);
assert.equal(+expiresAt, +now + 15 * 60_000);
assert.equal(verifyAccessToken(token, now), "sess_1");
assert.equal(verifyAccessToken(token, new Date(+now + 14 * 60_000)), "sess_1", "still valid inside 15 minutes");
assert.equal(verifyAccessToken(token, new Date(+now + 15 * 60_000)), null, "expired at 15 minutes");
assert.equal(verifyAccessToken(token, new Date(+now + 3600_000)), null);

// tampering: payload, signature, another secret, another prefix
const [v, body, sig] = token.split(".");
const forged = Buffer.from(JSON.stringify({ sid: "sess_2", exp: Math.floor(+now / 1000) + 900 })).toString("base64url");
assert.equal(verifyAccessToken(`${v}.${forged}.${sig}`, now), null, "a changed payload breaks the signature");
assert.equal(verifyAccessToken(`${v}.${body}.${sig.slice(0, -2)}AA`, now), null);
assert.equal(verifyAccessToken(`${v}.${body}.${sig}x`, now), null);
assert.equal(verifyAccessToken(token, now, "another-secret-entirely"), null);
assert.equal(verifyAccessToken(`v2.${body}.${sig}`, now), null);
for (const bad of ["", "abc", "a.b", "v1..", "v1.x.y", "v1.x.y.z", null as unknown as string, undefined as unknown as string]) {
  assert.equal(verifyAccessToken(bad, now), null, String(bad));
}
// a validly signed token whose payload is not what we expect is refused
const odd = Buffer.from(JSON.stringify({ sid: 5, exp: "soon" })).toString("base64url");
const oddSig = createHmac("sha256", process.env.AUTH_SECRET).update(`v1.${odd}`).digest("base64url");
assert.equal(verifyAccessToken(`v1.${odd}.${oddSig}`, now), null);
// no secret configured: signing refuses, verifying never throws
const keep = process.env.AUTH_SECRET;
delete process.env.AUTH_SECRET;
assert.throws(() => signAccessToken("s", now), /AUTH_SECRET/);
assert.equal(verifyAccessToken(token, now), null);
process.env.AUTH_SECRET = keep;
// a dedicated secret wins over AUTH_SECRET
process.env.MOBILE_TOKEN_SECRET = "dedicated-mobile-secret";
const t2 = signAccessToken("sess_9", now).token;
assert.equal(verifyAccessToken(t2, now), "sess_9");
delete process.env.MOBILE_TOKEN_SECRET;
assert.equal(verifyAccessToken(t2, now), null, "signed with the dedicated secret, not valid without it");

// ---- refresh tokens
const a = newRefreshToken();
const b = newRefreshToken();
assert.match(a.token, /^r1_[\w-]{40,}$/);
assert.notEqual(a.token, b.token);
assert.equal(a.hash, hashRefresh(a.token));
assert.match(a.hash, /^[0-9a-f]{64}$/);
assert.notEqual(a.hash, a.token, "only the hash is stored");

// ---- bearer header
assert.equal(bearerFrom("Bearer abcdefghijkl"), "abcdefghijkl");
assert.equal(bearerFrom("bearer abcdefghijkl"), "abcdefghijkl");
for (const bad of [null, undefined, "", "Basic abcdefghijkl", "Bearer", "Bearer short", "Bearer a b c d e f g h i j k", `Bearer ${"x".repeat(2001)}`]) {
  assert.equal(bearerFrom(bad as string | null), null, String(bad));
}

console.log("mobile tokens: all checks passed");
