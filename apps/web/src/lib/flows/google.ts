import { randomBytes } from "node:crypto";
import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/security/password";
import { hit, limitKey } from "@/lib/security/rate-limit";
import { provisionCompany } from "@/lib/org/provision";
import { loadDefaultMembership } from "@/lib/org/membership-load";
import { uniqueSlug } from "@/lib/org/starter-data";
import { trialDays } from "@/lib/plans/entitlements";

/**
 * Sign in or sign up with a Google account.
 *
 * Google proves the person owns the address, so a confirmed email is required (never an unconfirmed one) and the account is matched by
 * that address. What this deliberately does NOT do:
 *  - skip two-step sign-in: someone who turned it on must use their password and code, so Google cannot be a way around it;
 *  - revive a deleted account, or enter a suspended or closed company;
 *  - give a Google-created account a password anyone knows (it gets a random one; the person can set their own with "Forgot your password?").
 * A brand new person gets a company of their own on a free trial, named after them (they can rename it), and accepts the terms by continuing.
 */

export type GoogleProfile = { email?: string | null; email_verified?: boolean | null; name?: string | null };
import type { GoogleFailure } from "@/lib/flows/google-messages";

export type { GoogleFailure };
export type GoogleResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: GoogleFailure };

export function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function companyNameFor(name: string, email: string) {
  const first = name.trim().split(/\s+/)[0] || email.split("@")[0];
  return `${first.slice(0, 40)}'s company`;
}

export async function resolveGoogleSignIn(profile: GoogleProfile): Promise<GoogleResult> {
  const email = profile.email?.trim().toLowerCase();
  if (!email || email.length > 160 || !email.includes("@")) return { ok: false, reason: "bad_profile" };
  if (profile.email_verified !== true) return { ok: false, reason: "unverified" };

  const existing = await rawDb.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.deletedAt) return { ok: false, reason: "deleted" };
    if (existing.totpEnabledAt) return { ok: false, reason: "two_step" };
    if (!(await loadDefaultMembership(existing.id))) return { ok: false, reason: "no_company" };
    if (!existing.emailVerifiedAt) {
      // Google just proved the address is theirs: the same proof as the emailed link.
      await rawDb.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
    }
    return { ok: true, userId: existing.id, created: false };
  }

  // Creating accounts and trials: a loose limit for the whole site, to blunt scripts (Google already limits real people).
  const limit = await hit(limitKey("google:signup", "all"), 60, 3600);
  if (!limit.allowed) return { ok: false, reason: "busy" };

  const name = (profile.name?.trim() || email.split("@")[0]).slice(0, 80);
  const companyName = companyNameFor(name, email);
  const slug = await uniqueSlug(companyName, async (s) => Boolean(await rawDb.organization.findUnique({ where: { slug: s }, select: { id: true } })));
  const passwordHash = await hashPassword(randomBytes(24).toString("hex"));
  try {
    const created = await rawDb.$transaction(async (tx) => {
      const made = await provisionCompany(tx, { companyName, slug, country: "IN", adminName: name, adminEmail: email, passwordHash, termsAccepted: true, mode: { kind: "trial", days: trialDays() } });
      await tx.user.update({ where: { id: made.user.id }, data: { emailVerifiedAt: new Date() } });
      return made;
    });
    await logActivity({ userId: created.user.id, organizationId: created.org.id, action: "USER_SIGNED_UP", module: "AUTH", entityId: created.org.id, details: { company: companyName, via: "google" } });
    return { ok: true, userId: created.user.id, created: true };
  } catch (error) {
    // Two Google sign-ins for a new address at the same moment: the loser simply signs in as the account the winner made.
    if ((error as { code?: string }).code === "P2002") {
      const again = await rawDb.user.findUnique({ where: { email } });
      if (again && !again.deletedAt && !again.totpEnabledAt) return { ok: true, userId: again.id, created: false };
    }
    throw error;
  }
}

/** The account a verified Google sign-in belongs to, in the shape the session needs. Null when it cannot sign in. */
export async function googleSessionUser(email: string | null | undefined) {
  const address = email?.trim().toLowerCase();
  if (!address) return null;
  const user = await rawDb.user.findUnique({ where: { email: address } });
  if (!user || user.deletedAt || user.totpEnabledAt || !user.emailVerifiedAt) return null;
  const membership = await loadDefaultMembership(user.id);
  if (!membership) return null;
  await logActivity({ userId: user.id, organizationId: membership.organizationId, action: "LOGIN", module: "AUTH", entityId: user.id, details: { email: user.email, organizationId: membership.organizationId, via: "google" } });
  return { id: user.id, name: user.name, email: user.email, role: membership.role, orgId: membership.organizationId, orgRole: membership.role, sv: user.sessionVersion };
}
