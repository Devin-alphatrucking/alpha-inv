import type { RoleName } from "@/lib/roles";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { verifyPassword } from "@/lib/security/password";
import { checkSecondFactor } from "@/lib/flows/two-factor";
import { isOrgAllowedToSignIn, pickDefaultMembership } from "@/lib/org/default-membership";
import { hashRefresh, newRefreshToken, signAccessToken, verifyAccessToken } from "./token";

/**
 * Mobile sign-in sessions (Phase 7). Same rules as the web sign-in (rate limits, verified email, a company that may be entered),
 * but the app keeps tokens instead of a cookie:
 *  - access token: 15 minutes, names a session; permissions are re-read from the database on every request
 *  - refresh token: rotated on every use; stored hashed; an OLD one shown again means it was copied, so the session is revoked
 *  - "sign out everywhere", a password change, a removed member or a closed company end the session at once, because each
 *    request re-checks them
 */

const REFRESH_DAYS = 60;
const ABSOLUTE_DAYS = 180;
/** Two refreshes from the same device at the same moment are not theft: the loser is told to retry instead of being revoked. */
const ROTATION_GRACE_MS = 30_000;
const DAY = 86_400_000;

export type MobileUser = { id: string; role: RoleName; orgId: string; orgRole: RoleName; name: string; email: string; sessionId: string };

export type Tokens = { accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string };

export type MobileResult<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string; status: number };
const fail = (status: number, code: string, error: string) => ({ ok: false as const, status, code, error });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(200),
  deviceName: z.string().trim().max(80).optional(),
  platform: z.enum(["ios", "android"]).optional(),
  appVersion: z.string().trim().max(30).optional(),
  totp: z.string().trim().max(20).optional(),
});

function issue(sessionId: string, refresh: { token: string }, refreshExpiresAt: Date): Tokens {
  const access = signAccessToken(sessionId);
  return { accessToken: access.token, accessExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh.token, refreshExpiresAt: refreshExpiresAt.toISOString() };
}

export async function loginMobile(raw: unknown, ctx: { ip: string }): Promise<MobileResult<{ tokens: Tokens; userId: string; orgId: string }>> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_input", "Enter your email and password.");
  const v = parsed.data;

  // Same counters as the web sign-in, so guessing cannot be split between the website and the app.
  const limit = await hitAll([
    { key: limitKey("login:email", v.email), limit: 10, windowSeconds: 900 },
    { key: limitKey("login:ip", ctx.ip), limit: 40, windowSeconds: 900 },
  ]);
  if (!limit.allowed) return fail(429, "rate_limited", retryMessage(limit.retryAfterSeconds));

  const user = await rawDb.user.findUnique({ where: { email: v.email } });
  const matches = await verifyPassword(v.password, user?.passwordHash);
  if (!user || user.deletedAt || !matches) return fail(401, "invalid_credentials", "Email or password is not correct.");
  if (!user.emailVerifiedAt) return fail(403, "email_not_verified", "Confirm your email first. We sent you a link when you signed up.");

  // Two-step sign-in: same rule as the website. `totp_required` is only said after the password was right.
  if (user.totpEnabledAt) {
    if (!v.totp) return fail(401, "totp_required", "Enter the 6-digit code from your authenticator app.");
    const second = await checkSecondFactor(user.id, v.totp);
    if (!second.ok) {
      return second.reason === "rate_limited" ? fail(429, "rate_limited", "Too many tries. Please wait a few minutes.") : fail(401, "totp_invalid", "That code is not right or was already used. Wait for the next one and try again.");
    }
  }

  const memberships = await rawDb.membership.findMany({
    where: { userId: user.id },
    select: { organizationId: true, role: true, createdAt: true, organization: { select: { status: true } } },
  });
  const membership = pickDefaultMembership(memberships);
  if (!membership) return fail(403, "no_company", "Your company cannot be opened right now. Contact support.");

  return startSession(user, membership.organizationId, v, ctx, "mobile");
}

/** Opens a phone session for a person who has already proved who they are (password, or Google). */
export async function startSession(
  user: { id: string; sessionVersion: number },
  organizationId: string,
  device: { deviceName?: string; platform?: "ios" | "android"; appVersion?: string },
  ctx: { ip: string },
  via: "mobile" | "google",
): Promise<{ ok: true; tokens: Tokens; userId: string; orgId: string }> {
  const refresh = newRefreshToken();
  const now = new Date();
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_DAYS * DAY);
  const session = await rawDb.mobileSession.create({
    data: {
      userId: user.id,
      organizationId,
      refreshHash: refresh.hash,
      sessionVersion: user.sessionVersion,
      deviceName: device.deviceName ?? null,
      platform: device.platform ?? null,
      appVersion: device.appVersion ?? null,
      ip: ctx.ip.slice(0, 64),
      refreshExpiresAt,
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_DAYS * DAY),
    },
  });
  await logActivity({ userId: user.id, organizationId, action: "LOGIN", module: "AUTH", entityId: user.id, details: { via: via === "google" ? "mobile-google" : "mobile", platform: device.platform ?? null, device: device.deviceName ?? null } });
  return { ok: true, tokens: issue(session.id, refresh, refreshExpiresAt), userId: user.id, orgId: organizationId };
}

async function revoke(sessionId: string, reason: string) {
  await rawDb.mobileSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

/** Exchanges a refresh token for a new pair. The old refresh token stops working. */
export async function refreshMobile(refreshToken: unknown, ctx: { ip: string }): Promise<MobileResult<{ tokens: Tokens }>> {
  if (typeof refreshToken !== "string" || refreshToken.length < 20 || refreshToken.length > 200) return fail(401, "invalid_refresh", "Please sign in again.");
  const limit = await hitAll([{ key: limitKey("mobile:refresh:ip", ctx.ip), limit: 120, windowSeconds: 900 }]);
  if (!limit.allowed) return fail(429, "rate_limited", retryMessage(limit.retryAfterSeconds));

  const hash = hashRefresh(refreshToken);
  const now = new Date();

  const current = await rawDb.mobileSession.findUnique({ where: { refreshHash: hash } });
  if (!current) {
    const reused = await rawDb.mobileSession.findFirst({ where: { previousRefreshHash: hash } });
    if (reused && !reused.revokedAt) {
      if (now.getTime() - (reused.refreshedAt ?? reused.lastUsedAt).getTime() < ROTATION_GRACE_MS) return fail(409, "refresh_in_progress", "Please try again.");
      await revoke(reused.id, "refresh token reuse");
      await logActivity({ userId: reused.userId, organizationId: reused.organizationId, action: "SESSIONS_REVOKED", module: "AUTH", entityId: reused.id, details: { via: "mobile", reason: "refresh token reuse" } });
    }
    return fail(401, "invalid_refresh", "Please sign in again.");
  }
  if (current.revokedAt || current.refreshExpiresAt <= now || current.absoluteExpiresAt <= now) return fail(401, "session_ended", "Please sign in again.");

  const user = await rawDb.user.findUnique({ where: { id: current.userId }, select: { sessionVersion: true, deletedAt: true } });
  if (!user || user.deletedAt || user.sessionVersion !== current.sessionVersion) {
    await revoke(current.id, "signed out everywhere");
    return fail(401, "session_ended", "Please sign in again.");
  }
  const m = await rawDb.membership.findUnique({
    where: { userId_organizationId: { userId: current.userId, organizationId: current.organizationId } },
    select: { organization: { select: { status: true } } },
  });
  if (!m || !isOrgAllowedToSignIn(m.organization.status)) {
    await revoke(current.id, "company not available");
    return fail(401, "session_ended", "Please sign in again.");
  }

  const next = newRefreshToken();
  const refreshExpiresAt = new Date(Math.min(now.getTime() + REFRESH_DAYS * DAY, current.absoluteExpiresAt.getTime()));
  // Claim the rotation: only one of two simultaneous refreshes can win.
  const claimed = await rawDb.mobileSession.updateMany({
    where: { id: current.id, refreshHash: hash, revokedAt: null },
    data: { refreshHash: next.hash, previousRefreshHash: hash, lastUsedAt: now, refreshedAt: now, refreshExpiresAt },
  });
  if (claimed.count !== 1) return fail(409, "refresh_in_progress", "Please try again.");
  return { ok: true, tokens: issue(current.id, next, refreshExpiresAt) };
}

export async function logoutMobile(sessionId: string, userId: string) {
  await revoke(sessionId, "signed out");
  await logActivity({ userId, action: "LOGOUT", module: "AUTH", entityId: userId, details: { via: "mobile" } });
}

const TOUCH_EVERY_MS = 5 * 60_000;

/** The person behind a bearer token, or null. Everything is checked against the database on each call. */
export async function authenticateBearer(token: string): Promise<MobileUser | null> {
  const sid = verifyAccessToken(token);
  if (!sid) return null;
  const now = new Date();
  const s = await rawDb.mobileSession.findUnique({
    where: { id: sid },
    include: { user: { select: { id: true, name: true, email: true, sessionVersion: true, deletedAt: true, emailVerifiedAt: true } } },
  });
  if (!s || s.revokedAt || s.absoluteExpiresAt <= now || s.refreshExpiresAt <= now) return null;
  if (s.user.deletedAt || !s.user.emailVerifiedAt || s.user.sessionVersion !== s.sessionVersion) return null;
  const m = await rawDb.membership.findUnique({
    where: { userId_organizationId: { userId: s.userId, organizationId: s.organizationId } },
    select: { role: true, organization: { select: { status: true } } },
  });
  if (!m || !isOrgAllowedToSignIn(m.organization.status)) return null;
  if (now.getTime() - s.lastUsedAt.getTime() > TOUCH_EVERY_MS) await rawDb.mobileSession.update({ where: { id: s.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  return { id: s.user.id, role: m.role, orgId: s.organizationId, orgRole: m.role, name: s.user.name, email: s.user.email, sessionId: s.id };
}

/** Moves the session to another company the person belongs to. */
export async function switchCompanyMobile(sessionId: string, userId: string, orgId: unknown): Promise<MobileResult<{ orgId: string }>> {
  if (typeof orgId !== "string") return fail(400, "invalid_input", "Choose a company.");
  const m = await rawDb.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: { organization: { select: { status: true } } },
  });
  if (!m || !isOrgAllowedToSignIn(m.organization.status)) return fail(403, "no_company", "That company cannot be opened.");
  await rawDb.mobileSession.update({ where: { id: sessionId }, data: { organizationId: orgId } });
  await logActivity({ userId, organizationId: orgId, action: "COMPANY_SWITCHED", module: "AUTH", entityId: orgId, details: { via: "mobile" } });
  return { ok: true, orgId };
}
