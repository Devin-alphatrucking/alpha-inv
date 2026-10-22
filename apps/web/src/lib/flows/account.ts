import { randomBytes } from "node:crypto";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { checkPassword, hashPassword, verifyPassword } from "@/lib/security/password";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { sendMail } from "@/lib/email/transport";
import { accountDeletedMail, passwordChangedMail } from "@/lib/email/templates";
import { PRODUCT_NAME } from "@/lib/brand/product";
import type { FlowResult } from "@/lib/flows/schemas";

const mailBrand = { name: PRODUCT_NAME };

/** Password checks on a signed-in account are rate limited too (someone with a stolen session must not be able to guess the password). */
async function confirmPassword(userId: string, password: string) {
  const limit = await hit(limitKey("account-password", userId), 10, 900);
  if (!limit.allowed) return { ok: false as const, error: retryMessage(limit.retryAfterSeconds) };
  const user = await rawDb.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) return { ok: false as const, error: "Account not found." };
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false as const, error: "That password is not correct.", field: "password" };
  return { ok: true as const, user };
}

/** Change the password of the signed-in person. All other sessions are signed out (the caller refreshes its own). */
export async function changePassword(userId: string, current: string, next: string): Promise<FlowResult> {
  const check = await confirmPassword(userId, current);
  if (!check.ok) return check;
  const problem = checkPassword(next, { email: check.user.email, name: check.user.name });
  if (problem) return { ok: false, error: problem, field: "newPassword" };
  if (next === current) return { ok: false, error: "Choose a password you have not used just now.", field: "newPassword" };

  await rawDb.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "PASSWORD_CHANGED", module: "AUTH", entityId: userId });
  await sendMail(passwordChangedMail(check.user.email, { name: check.user.name, brand: mailBrand }));
  return { ok: true };
}

/** Signs the person out of every device. */
export async function signOutEverywhere(userId: string): Promise<FlowResult> {
  await rawDb.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "SESSIONS_REVOKED", module: "AUTH", entityId: userId });
  return { ok: true };
}

/** Companies where this person is the only administrator (deleting them would orphan the company). */
export async function companiesOnlyAdministeredBy(userId: string) {
  const mine = await rawDb.membership.findMany({
    where: { userId, role: "ADMIN" },
    select: { organizationId: true, organization: { select: { name: true, status: true } } },
  });
  const blocked: { id: string; name: string }[] = [];
  for (const m of mine) {
    if (m.organization.status === "CLOSED") continue;
    const others = await rawDb.membership.count({
      where: { organizationId: m.organizationId, role: "ADMIN", userId: { not: userId }, user: { deletedAt: null } },
    });
    if (others === 0) blocked.push({ id: m.organizationId, name: m.organization.name });
  }
  return blocked;
}

/**
 * Deletes the account. Personal details are erased (name, email, password) and every company membership and project
 * assignment is removed; the row itself stays so that records the person created keep a valid, anonymous author.
 */
export async function deleteAccount(userId: string, password: string): Promise<FlowResult> {
  const check = await confirmPassword(userId, password);
  if (!check.ok) return check;
  const user = check.user;

  const blocked = await companiesOnlyAdministeredBy(userId);
  if (blocked.length > 0) {
    const names = blocked.map((b) => `"${b.name}"`).join(", ");
    return {
      ok: false,
      error: `You are the only administrator of ${names}. Make someone else an administrator, or close the company, before deleting your account.`,
    };
  }

  const memberships = await rawDb.membership.findMany({ where: { userId }, select: { organizationId: true } });

  // Send the notice to the real address first: after this the address no longer exists in our records.
  await sendMail(accountDeletedMail(user.email, { name: user.name, brand: mailBrand }));

  // Project assignments are company-protected rows: remove them company by company.
  for (const m of memberships) {
    await dbFor(m.organizationId).projectAssignment.deleteMany({ where: { userId } });
  }
  await rawDb.$transaction([
    rawDb.membership.deleteMany({ where: { userId } }),
    rawDb.authToken.deleteMany({ where: { OR: [{ userId }, { email: user.email }] } }),
    rawDb.user.update({
      where: { id: userId },
      data: {
        name: "Deleted user",
        email: `deleted-${userId}@deleted.invalid`,
        passwordHash: await hashPassword(randomBytes(24).toString("hex")),
        deletedAt: new Date(),
        emailVerifiedAt: null,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);

  for (const m of memberships) {
    await logActivity({ userId, organizationId: m.organizationId, action: "ACCOUNT_DELETED", module: "AUTH", entityId: userId });
  }
  return { ok: true };
}

/**
 * Closes a company: nobody in it can sign in any more. Data is kept (so it can be restored or exported on request) until
 * it is purged under your retention policy; there is no automatic purge job yet.
 */
export async function closeCompany(admin: { id: string; orgId: string }, password: string): Promise<FlowResult> {
  const check = await confirmPassword(admin.id, password);
  if (!check.ok) return check;
  const membership = await rawDb.membership.findUnique({ where: { userId_organizationId: { userId: admin.id, organizationId: admin.orgId } } });
  if (membership?.role !== "ADMIN") return { ok: false, error: "Only a company administrator can close the company." };

  await rawDb.$transaction([
    rawDb.organization.update({ where: { id: admin.orgId }, data: { status: "CLOSED" } }),
    rawDb.authToken.updateMany({ where: { organizationId: admin.orgId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    // everyone in the company is signed out
    rawDb.user.updateMany({ where: { memberships: { some: { organizationId: admin.orgId } } }, data: { sessionVersion: { increment: 1 } } }),
  ]);
  await logActivity({ userId: admin.id, organizationId: admin.orgId, action: "COMPANY_CLOSED", module: "COMPANY", entityId: admin.orgId });
  return { ok: true };
}

/** The companies a person belongs to (for the company switcher). Closed or suspended ones are left out. */
export async function listMyCompanies(userId: string) {
  const rows = await rawDb.membership.findMany({
    where: { userId, organization: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true, organization: { select: { name: true, displayName: true } } },
  });
  return rows.map((r) => ({ id: r.organizationId, name: r.organization.displayName || r.organization.name, role: r.role }));
}
