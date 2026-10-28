import { needsProjects, type RoleName } from "@/lib/roles";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { checkPassword, hashPassword } from "@/lib/security/password";
import { claimToken, hashToken, issueToken, peekToken } from "@/lib/security/tokens";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { inviteMail } from "@/lib/email/templates";
import { absoluteUrl } from "@/lib/app-url";
import { assertCanAddUsers, assertCanInvite } from "@/lib/plans/entitlements";
import { AppError } from "@/lib/errors";
import { acceptInviteSchema, firstIssue, inviteSchema, type FlowResult } from "@/lib/flows/schemas";
import { normalizePhone } from "@/lib/security/phone";

export type Admin = { id: string; name: string; orgId: string };

/** An administrator invites someone by email. They choose the role and (for staff) the projects. */
export async function createInvite(admin: Admin, raw: unknown): Promise<FlowResult<{ message: string }>> {
  if (!isEmailConfigured()) return { ok: false, error: "Email is not set up on this server, so invitations cannot be sent." };
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const v = parsed.data;

  const limit = await hitAll([
    { key: limitKey("invite:admin", admin.id), limit: 30, windowSeconds: 86400 },
    { key: limitKey("invite:org", admin.orgId), limit: 100, windowSeconds: 86400 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  const existing = await rawDb.user.findUnique({ where: { email: v.email }, select: { id: true, deletedAt: true } });
  if (existing && !existing.deletedAt) {
    const already = await rawDb.membership.findUnique({ where: { userId_organizationId: { userId: existing.id, organizationId: admin.orgId } } });
    if (already) return { ok: false, error: "That person already belongs to your company.", field: "email" };
  }

  // Projects must be this company's (they come from the browser).
  const projectIds = needsProjects(v.role) ? [...new Set(v.projectIds)] : [];
  if (projectIds.length > 0) {
    const count = await dbFor(admin.orgId).project.count({ where: { id: { in: projectIds } } });
    if (count !== projectIds.length) return { ok: false, error: "One or more selected projects were not found." };
  }

  // The plan limits people (members plus open invitations). Refused here with a plain message.
  try {
    await assertCanInvite(admin.orgId);
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_001") return { ok: false, error: error.message };
    // Someone signed up with this address a moment ago: the unique email rule stopped the second account. Ask them to sign in instead.
    if ((error as { code?: string })?.code === "P2002") {
      return { ok: false, error: "An account with this email already exists. Sign in instead, then open this invitation again." };
    }
    throw error;
  }

  const org = await rawDb.organization.findUniqueOrThrow({ where: { id: admin.orgId } });
  const token = await issueToken({
    type: "INVITE",
    email: v.email,
    organizationId: admin.orgId,
    role: v.role,
    createdById: admin.id,
    payload: { projectIds, invitedByName: admin.name },
  });
  const sent = await sendMail(
    inviteMail(v.email, {
      inviterName: admin.name,
      company: org.displayName || org.name,
      role: v.role,
      link: absoluteUrl(`/accept-invite?token=${token}`),
      brand: { name: org.displayName || org.name, color: org.primaryColor, supportEmail: org.supportEmail },
    })
  );
  if (!sent.ok) return { ok: false, error: "The invitation could not be emailed. Check the email settings and try again." };

  await logActivity({ userId: admin.id, organizationId: admin.orgId, action: "USER_INVITED", module: "USER", details: { role: v.role, projects: projectIds.length } });
  return { ok: true, message: `Invitation sent to ${v.email}.` };
}

export type PendingInvite = { id: string; email: string; role: RoleName; createdAt: Date; expiresAt: Date };

/** Open invitations of one company. */
export async function listPendingInvites(orgId: string): Promise<PendingInvite[]> {
  const rows = await rawDb.authToken.findMany({
    where: { type: "INVITE", organizationId: orgId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
  });
  return rows.map((r) => ({ ...r, role: (r.role ?? "STAFF") as RoleName }));
}

export async function revokeInvite(admin: Admin, inviteId: string): Promise<FlowResult> {
  const result = await rawDb.authToken.updateMany({
    where: { id: inviteId, type: "INVITE", organizationId: admin.orgId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return { ok: false, error: "Invitation not found." };
  await logActivity({ userId: admin.id, organizationId: admin.orgId, action: "INVITE_REVOKED", module: "USER", entityId: inviteId });
  return { ok: true };
}

/** What the invitation page needs to show. Null for a bad, used, cancelled or expired link. */
export async function describeInvite(token: string | null | undefined) {
  const row = await peekToken(token, "INVITE");
  if (!row || !row.organizationId) return null;
  const [org, existing] = await Promise.all([
    rawDb.organization.findUnique({ where: { id: row.organizationId }, select: { name: true, displayName: true, slug: true, primaryColor: true, status: true } }),
    rawDb.user.findUnique({ where: { email: row.email }, select: { id: true, deletedAt: true } }),
  ]);
  if (!org || ["SUSPENDED", "CLOSED"].includes(org.status)) return null;
  const payload = (row.payload ?? {}) as { invitedByName?: string };
  return {
    email: row.email,
    role: (row.role ?? "STAFF") as RoleName,
    company: org.displayName || org.name,
    slug: org.slug,
    color: org.primaryColor,
    inviterName: payload.invitedByName ?? "An administrator",
    hasAccount: Boolean(existing && !existing.deletedAt),
    existingUserId: existing && !existing.deletedAt ? existing.id : null,
  };
}

/**
 * Accepting an invitation. Someone new sets a name and password (and their address counts as confirmed, because the
 * link reached their inbox). Someone who already has an account must be signed in as that account.
 */
export async function acceptInvite(raw: unknown, signedInUserId: string | null): Promise<FlowResult<{ slug: string; joinedExisting: boolean }>> {
  const parsed = acceptInviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const v = parsed.data;

  const invite = await describeInvite(v.token);
  if (!invite) return { ok: false, error: "This invitation is invalid, has expired or was cancelled. Ask for a new one." };

  const row = await peekToken(v.token, "INVITE");
  if (!row || !row.organizationId) return { ok: false, error: "This invitation is invalid, has expired or was cancelled. Ask for a new one." };
  const orgId = row.organizationId;
  const role = (row.role ?? "STAFF") as RoleName;
  const wantedProjects = ((row.payload ?? {}) as { projectIds?: string[] }).projectIds ?? [];

  let passwordHash: string | null = null;
  let newPhone: string | null = null;
  if (invite.hasAccount) {
    if (signedInUserId !== invite.existingUserId) {
      return { ok: false, error: `Sign in as ${invite.email} to accept this invitation.` };
    }
  } else {
    if (!v.name?.trim()) return { ok: false, error: "Enter your name.", field: "name" };
    if (!v.acceptTerms) return { ok: false, error: "Please accept the terms to continue.", field: "acceptTerms" };
    const problem = checkPassword(v.password ?? "", { email: invite.email, name: v.name });
    if (problem) return { ok: false, error: problem, field: "password" };
    passwordHash = await hashPassword(v.password!);
    const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { country: true } });
    const phone = normalizePhone(v.phone, org?.country ?? "IN");
    if (!phone.ok) return { ok: false, error: phone.error, field: "phone" };
    newPhone = phone.phone;
  }

  let outcome: { userId: string } | null;
  try {
    outcome = await rawDb.$transaction(async (tx) => {
    const claimed = await claimToken(tx, v.token, "INVITE");
    if (!claimed || claimed.tokenHash !== hashToken(v.token)) return null;

    // The seat is checked now, with the company locked: the invitation itself no longer counts (it was just used),
    // and someone who is already a member takes no new seat. A refusal rolls back the link, so it stays usable.
    const alreadyMember = invite.existingUserId
      ? await tx.membership.findUnique({ where: { userId_organizationId: { userId: invite.existingUserId, organizationId: orgId } }, select: { id: true } })
      : null;
    if (!alreadyMember) await assertCanAddUsers(tx, orgId);

    let userId = invite.existingUserId;
    if (!userId) {
      const user = await tx.user.create({
        data: {
          name: v.name!.trim(),
          email: invite.email,
          phone: newPhone,
          passwordHash: passwordHash!,
          role,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
        },
      });
      userId = user.id;
    } else {
      await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    }
    await tx.membership.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, role },
      update: { role },
    });
    if (needsProjects(role) && wantedProjects.length > 0) {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      const valid = await tx.project.findMany({ where: { id: { in: wantedProjects }, organizationId: orgId }, select: { id: true } });
      if (valid.length > 0) {
        await tx.projectAssignment.createMany({
          data: valid.map((p) => ({ organizationId: orgId, userId: userId!, projectId: p.id })),
          skipDuplicates: true,
        });
      }
    }
    return { userId };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_001") {
      return { ok: false, error: `${invite.company} has reached its user limit, so you cannot join yet. Ask an administrator to make room. This invitation stays valid.` };
    }
    throw error;
  }
  if (!outcome) return { ok: false, error: "This invitation is invalid, has expired or was cancelled. Ask for a new one." };

  await logActivity({ userId: outcome.userId, organizationId: orgId, action: "INVITE_ACCEPTED", module: "USER", entityId: outcome.userId, details: { role } });
  return { ok: true, slug: invite.slug, joinedExisting: invite.hasAccount };
}
