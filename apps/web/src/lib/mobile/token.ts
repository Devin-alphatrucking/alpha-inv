import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Access tokens for the mobile apps: "v1.<payload>.<signature>". The payload names a SESSION and an expiry only;
// who the person is, their company and role are always read from the database on each request, so a token
// can never carry stale permissions. Signed with HMAC-SHA256 using the server secret.

export const ACCESS_TTL_SECONDS = 15 * 60;

function secret() {
  const s = process.env.MOBILE_TOKEN_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!s || s.length < 8) throw new Error("AUTH_SECRET (or MOBILE_TOKEN_SECRET) must be set to issue mobile tokens.");
  return s;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const sign = (data: string, key: string) => createHmac("sha256", key).update(data).digest("base64url");

export function signAccessToken(sessionId: string, now: Date = new Date(), ttlSeconds = ACCESS_TTL_SECONDS, key: string = secret()) {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const body = b64(JSON.stringify({ sid: sessionId, exp }));
  return { token: `v1.${body}.${sign(`v1.${body}`, key)}`, expiresAt: new Date(exp * 1000) };
}

/** Returns the session id for a valid, unexpired token, otherwise null. Never throws on bad input. */
export function verifyAccessToken(token: string, now: Date = new Date(), key?: string): string | null {
  try {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const k = key ?? secret();
    const want = Buffer.from(sign(`v1.${parts[1]}`, k));
    const got = Buffer.from(parts[2]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sid?: unknown; exp?: unknown };
    if (typeof payload.sid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now.getTime()) return null;
    return payload.sid;
  } catch {
    return null;
  }
}

export const hashRefresh = (token: string) => createHash("sha256").update(token).digest("hex");

export function newRefreshToken() {
  const token = `r1_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashRefresh(token) };
}

export function bearerFrom(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S{10,2000})$/i.exec(header ?? "");
  return m ? m[1] : null;
}
