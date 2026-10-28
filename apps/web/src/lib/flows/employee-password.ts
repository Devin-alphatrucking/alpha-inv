import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkPassword, hashPassword } from "@/lib/security/password";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { sendMail } from "@/lib/email/transport";
import { passwordSetByAdminMail } from "@/lib/email/templates";
import { requestPasswordReset } from "@/lib/flows/verify-reset";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * An administrator helping a colleague who is locked out. Two ways, and the safe one is always available:
 *
 *  - Email a reset link: goes to the person's own inbox, so the administrator never knows the new password. Works for
 *    everyone in the company, including people who also belong to other companies.
 *  - Set a new password: the administrator types one and tells the person. Allowed ONLY for a person who belongs to this
 *    company alone (a password is one per person, so changing it would reach into their other companies), never for
 *    yourself (use My account) and never for our own platform operators. The person is signed out of every device,
 *    emailed that it happened, and it is written to the activity log. The caller confirms it is the administrator with an
 *    emailed code first (see lib/security/step-up.ts).
 */

type Admin = { id: string; orgId: string; name: string };

async function member(admin: Admin, userId: string) {
  const m = await rawDb.membership.findUnique({
    where: { userId_organizationId: { userId: String(userId), organizationId: admin.orgId } },
    include: { user: { select: { id: true, name: true, email: true, deletedAt: true, isPlatformAdmin: true } } },
  });
  return m && !m.user.deletedAt ? m : null;
}

export async function setEmployeePassword(admin: Admin, userId: string, newPassword: unknown): Promise<FlowResult> {
  if (typeof newPassword !== "string") return { ok: false, error: "Enter the new password.", field: "password" };
  const limit = await hit(limitKey("employee-password:admin", admin.id), 20, 3600);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  if (admin.id === userId) return { ok: false, error: "To change your own password use My account." };
  const target = await member(admin, userId);
  if (!target) return { ok: false, error: "That person is not in your company." };
  if (target.user.isPlatformAdmin) return { ok: false, error: "This account cannot be changed here." };

  const others = await rawDb.membership.count({ where: { userId: target.userId, organizationId: { not: admin.orgId } } });
  if (others > 0) {
    return { ok: false, error: `${target.user.name} also belongs to other companies, and a password is one per person. Email them a reset link instead.` };
  }

  const problem = checkPassword(newPassword, { email: target.user.email, name: target.user.name });
  if (problem) return { ok: false, error: problem, field: "password" };

  await rawDb.user.update({ where: { id: target.userId }, data: { passwordHash: await hashPassword(newPassword), sessionVersion: { increment: 1 } } });
  await rawDb.mobileSession.updateMany({ where: { userId: target.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "password_set_by_admin" } });

  const org = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { name: true, displayName: true, primaryColor: true, supportEmail: true } });
  const company = org?.displayName || org?.name || "your company";
  await sendMail(passwordSetByAdminMail(target.user.email, { name: target.user.name, adminName: admin.name, company, brand: { name: company, color: org?.primaryColor, supportEmail: org?.supportEmail } }));
  await logActivity({ userId: admin.id, organizationId: admin.orgId, action: "PASSWORD_SET_BY_ADMIN", module: "USER", entityId: target.userId, details: { for: target.user.email } });
  return { ok: true };
}

export async function sendEmployeeResetLink(admin: Admin, userId: string, ctx: { ip: string }): Promise<FlowResult<{ message: string }>> {
  const limit = await hit(limitKey("employee-reset:admin", admin.id), 30, 3600);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };
  const target = await member(admin, userId);
  if (!target) return { ok: false, error: "That person is not in your company." };
  if (target.user.isPlatformAdmin) return { ok: false, error: "This account cannot be changed here." };

  const sent = await requestPasswordReset(target.user.email, ctx);
  if (!sent.ok) return sent;
  await logActivity({ userId: admin.id, organizationId: admin.orgId, action: "PASSWORD_RESET_LINK_SENT", module: "USER", entityId: target.userId, details: { for: target.user.email } });
  return { ok: true, message: `A reset link and code were emailed to ${target.user.email}.` };
}
