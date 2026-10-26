import type { RoleName } from "@/lib/roles";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { isOrgAllowedToSignIn } from "@/lib/org/default-membership";
import { loadDefaultMembership } from "@/lib/org/membership-load";
import { operatorLogin } from "@/lib/flows/operator-login";
import { normalizeHost } from "@/lib/master/gate";
import { googleSessionUser, isGoogleConfigured, resolveGoogleSignIn } from "@/lib/flows/google";
import { verifyPassword } from "@/lib/security/password";
import { checkSecondFactor } from "@/lib/flows/two-factor";
import { clientIp, hitAll, limitKey } from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

/** Shown by the sign-in form as "confirm your email first". Only raised after the password was right. */
class EmailNotVerified extends CredentialsSignin {
  code = "email_not_verified";
}
/** Password was right and the account uses two-step sign-in: the form must ask for the code. Only raised AFTER the password check. */
class TotpRequired extends CredentialsSignin {
  code = "totp_required";
}
class TotpInvalid extends CredentialsSignin {
  code = "totp_invalid";
}
class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Proof that a session update comes from OUR server code. Auth.js lets a browser post to /api/auth/session with data of its own
 * choosing, which reaches the jwt callback as `session`, so a flag such as `refreshSv` cannot be trusted by itself: someone holding
 * an old cookie could use it to revive a session that "sign out everywhere" just ended. Only code that can read the server secret can make this value.
 */
export function serverUpdateProof(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  return createHmac("sha256", secret).update("session-update-v1").digest("hex");
}
function isServerUpdate(session: unknown): boolean {
  const given = (session as { serverProof?: unknown } | null)?.serverProof;
  if (typeof given !== "string") return false;
  const want = Buffer.from(serverUpdateProof());
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** How often an open session is re-checked against the database (sign-out-everywhere, role changes, closed companies). */
const RECHECK_MS = Number(process.env.SESSION_RECHECK_MS) || 60_000;

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  // Required for Cloudflare Tunnel / preview hosts (detect host from request).
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Code", type: "text" },
      },
      authorize: async (rawCredentials, request) => {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { password } = parsed.data;
        const email = parsed.data.email.trim().toLowerCase();

        // Guessing passwords: limit per address and per network address.
        const ip = clientIp(request.headers);
        const limit = await hitAll([
          { key: limitKey("login:email", email), limit: 10, windowSeconds: 900 },
          { key: limitKey("login:ip", ip), limit: 40, windowSeconds: 900 },
        ]);
        if (!limit.allowed) throw new TooManyAttempts();

        const user = await rawDb.user.findUnique({ where: { email } });
        // Always runs a real password comparison, so an unknown address looks the same as a wrong password.
        const passwordMatches = await verifyPassword(password, user?.passwordHash);
        if (!user || user.deletedAt || !passwordMatches) return null;

        // The address must be confirmed. Said only after the password was right, so this cannot reveal who has an account.
        if (!user.emailVerifiedAt) throw new EmailNotVerified();

        // Second step, when the person turned it on. A wrong or reused code is as final as a wrong password.
        if (user.totpEnabledAt) {
          const code = typeof rawCredentials?.totp === "string" ? rawCredentials.totp.trim() : "";
          if (!code) throw new TotpRequired();
          const second = await checkSecondFactor(user.id, code);
          if (!second.ok) throw second.reason === "rate_limited" ? new TooManyAttempts() : new TotpInvalid();
        }

        // No usable company (none, or suspended/closed) means no sign-in.
        const membership = await loadDefaultMembership(user.id);
        if (!membership) return null;

        await logActivity({
          userId: user.id,
          organizationId: membership.organizationId,
          action: "LOGIN",
          module: "AUTH",
          entityId: user.id,
          details: { email: user.email, organizationId: membership.organizationId },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: membership.role, // role inside the company
          orgId: membership.organizationId,
          orgRole: membership.role,
          sv: user.sessionVersion,
        };
      },
    }),
    // The master console's own sign-in (see lib/flows/operator-login.ts). With MASTER_HOST set it only answers on that address.
    Credentials({
      id: "operator",
      credentials: { email: {}, password: {}, code: {} },
      authorize: async (raw, request) => {
        const master = normalizeHost(process.env.MASTER_HOST);
        if (master && normalizeHost(request.headers.get("host")) !== master) return null;
        if (!master && process.env.NODE_ENV === "production") return null; // no master address configured: the normal sign-in is used
        const result = await operatorLogin({ email: raw?.email, password: raw?.password, code: raw?.code, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") });
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new TooManyAttempts();
          return null;
        }
        return result.user;
      },
    }),
    // Only offered when the site has Google credentials (see docs/GOOGLE-SIGN-IN.md).
    ...(isGoogleConfigured() ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })] : []),
  ],
  callbacks: {
    signIn: async ({ account, profile }) => {
      if (account?.provider !== "google") return true;
      try {
        const result = await resolveGoogleSignIn((profile ?? {}) as { email?: string; email_verified?: boolean; name?: string });
        return result.ok ? true : `/login?error=google_${result.reason}`;
      } catch (error) {
        console.error("Google sign-in failed", error);
        return "/login?error=google_failed";
      }
    },
    jwt: async ({ token, user, account, trigger, session }) => {
      if (user && account?.provider === "google") {
        // The sign-in step already checked the account; here the session is built from OUR database, never from what Google sent.
        const ours = await googleSessionUser(user.email);
        if (!ours) return null;
        token.role = ours.role;
        token.id = ours.id;
        token.orgId = ours.orgId;
        token.orgRole = ours.orgRole;
        token.sv = ours.sv;
        token.svAt = Date.now();
        token.name = ours.name;
        token.email = ours.email;
        return token;
      }
      if (user) {
        token.role = (user as { role: RoleName }).role; // membership role
        token.id = user.id as string;
        token.orgId = user.orgId;
        token.orgRole = user.orgRole;
        token.sv = (user as { sv?: number }).sv;
        token.svAt = Date.now();
        return token;
      }
      if (!token.id) return token;

      // The sections below only run for explicit server-side calls to update the session (never from the browser).
      if (trigger === "update" && session) {
        const wanted = (session as { switchOrgId?: string; refreshSv?: boolean }).switchOrgId;
        if (wanted) {
          const m = await rawDb.membership.findUnique({
            where: { userId_organizationId: { userId: token.id as string, organizationId: wanted } },
            select: { role: true, organization: { select: { status: true } } },
          });
          if (m && isOrgAllowedToSignIn(m.organization.status)) {
            token.orgId = wanted;
            token.orgRole = m.role;
            token.role = m.role;
          }
        }
        if ((session as { refreshSv?: boolean }).refreshSv && isServerUpdate(session)) {
          const u = await rawDb.user.findUnique({ where: { id: token.id as string }, select: { sessionVersion: true } });
          if (u) token.sv = u.sessionVersion;
        }
        token.svAt = 0; // re-check below
      }

      // Sessions created before companies existed: attach the company once.
      if (!token.orgId) {
        const membership = await loadDefaultMembership(token.id as string);
        if (membership) {
          token.orgId = membership.organizationId;
          token.orgRole = membership.role;
          token.role = membership.role;
        }
      }

      // Re-check the session against the database at most once a minute.
      if (!token.svAt || Date.now() - (token.svAt as number) > RECHECK_MS) {
        const u = await rawDb.user.findUnique({ where: { id: token.id as string }, select: { sessionVersion: true, deletedAt: true } });
        if (!u || u.deletedAt) return null; // account gone
        if (token.sv === undefined) token.sv = u.sessionVersion; // session from before this feature: adopt it
        else if (u.sessionVersion !== token.sv) return null; // signed out everywhere, or password changed

        if (token.orgId) {
          const m = await rawDb.membership.findUnique({
            where: { userId_organizationId: { userId: token.id as string, organizationId: token.orgId as string } },
            select: { role: true, organization: { select: { status: true } } },
          });
          if (!m || !isOrgAllowedToSignIn(m.organization.status)) return null; // removed from the company, or the company was closed
          token.role = m.role; // role changes take effect within a minute
          token.orgRole = m.role;
        }
        token.svAt = Date.now();
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as RoleName;
        session.user.orgId = token.orgId as string;
        session.user.orgRole = token.orgRole as RoleName;
      }
      return session;
    },
  },
});
