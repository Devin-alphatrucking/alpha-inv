import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { pickDefaultMembership, isOrgAllowedToSignIn } from "@/lib/org/default-membership";
import { verifyPassword } from "@/lib/security/password";
import { clientIp, hitAll, limitKey } from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

/** Shown by the sign-in form as "confirm your email first". Only raised after the password was right. */
class EmailNotVerified extends CredentialsSignin {
  code = "email_not_verified";
}
class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

/** How often an open session is re-checked against the database (sign-out-everywhere, role changes, closed companies). */
const RECHECK_MS = Number(process.env.SESSION_RECHECK_MS) || 60_000;

/** Default company + role for a user, or null if no company may be entered. */
async function loadDefaultMembership(userId: string) {
  const memberships = await rawDb.membership.findMany({
    where: { userId },
    select: {
      organizationId: true,
      role: true,
      createdAt: true,
      organization: { select: { status: true } },
    },
  });
  return pickDefaultMembership(memberships);
}

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
  ],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      if (user) {
        token.role = (user as { role: "ADMIN" | "STAFF" }).role; // membership role
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
        if ((session as { refreshSv?: boolean }).refreshSv) {
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
        session.user.role = token.role as "ADMIN" | "STAFF";
        session.user.orgId = token.orgId as string;
        session.user.orgRole = token.orgRole as "ADMIN" | "STAFF";
      }
      return session;
    },
  },
});
