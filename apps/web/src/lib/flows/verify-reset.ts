import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkPassword, hashPassword } from "@/lib/security/password";
import { claimToken, consumeToken, hashToken, issueToken, revokeTokens } from "@/lib/security/tokens";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { passwordChangedMail, passwordResetMail, verifyEmailMail } from "@/lib/email/templates";
import { absoluteUrl } from "@/lib/app-url";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { emailOnlySchema, firstIssue, resetSchema, type FlowResult } from "@/lib/flows/schemas";

const mailBrand = { name: PRODUCT_NAME };
const NEUTRAL = "If that address has an account, we have sent an email. It can take a minute to arrive.";

// ---------------------------------------------------------------- email verification

/** Marks the address as confirmed. Single use. */
export async function confirmEmail(token: string | null | undefined): Promise<FlowResult<{ email: string }>> {
  const row = await consumeToken(token, "EMAIL_VERIFY");
  if (!row || !row.userId) return { ok: false, error: "This confirmation link is invalid or has expired. Request a new one." };
  const user = await rawDb.user.findUnique({ where: { id: row.userId } });
  if (!user || user.deletedAt || user.email !== row.email) {
    return { ok: false, error: "This confirmation link is invalid or has expired. Request a new one." };
  }
  if (!user.emailVerifiedAt) {
    await rawDb.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const membership = await rawDb.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    await logActivity({ userId: user.id, organizationId: membership?.organizationId ?? null, action: "EMAIL_VERIFIED", module: "AUTH", entityId: user.id });
  }
  return { ok: true, email: user.email };
}

/** Sends a fresh confirmation link. Always answers the same way. */
export async function resendVerification(rawEmail: unknown, ctx: { ip: string }): Promise<FlowResult<{ message: string }>> {
  const parsed = emailOnlySchema.safeParse({ email: rawEmail });
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { email } = parsed.data;
  const limit = await hitAll([
    { key: limitKey("verify:ip", ctx.ip), limit: 10, windowSeconds: 3600 },
    { key: limitKey("verify:email", email), limit: 3, windowSeconds: 3600 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };
  if (!isEmailConfigured()) return { ok: false, error: "Email is not set up on this server." };

  const user = await rawDb.user.findUnique({ where: { email } });
  if (user && !user.deletedAt && !user.emailVerifiedAt) {
    const token = await issueToken({ type: "EMAIL_VERIFY", email, userId: user.id });
    await sendMail(verifyEmailMail(email, { name: user.name, link: absoluteUrl(`/verify-email?token=${token}`), brand: mailBrand }));
  }
  return { ok: true, message: NEUTRAL };
}

// ---------------------------------------------------------------- password reset

/** Emails a reset link when the address has an account. Always answers the same way. */
export async function requestPasswordReset(rawEmail: unknown, ctx: { ip: string }): Promise<FlowResult<{ message: string }>> {
  const parsed = emailOnlySchema.safeParse({ email: rawEmail });
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { email } = parsed.data;
  const limit = await hitAll([
    { key: limitKey("reset:ip", ctx.ip), limit: 10, windowSeconds: 3600 },
    { key: limitKey("reset:email", email), limit: 3, windowSeconds: 3600 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };
  if (!isEmailConfigured()) return { ok: false, error: "Email is not set up on this server, so passwords cannot be reset by email. Ask your administrator." };

  const user = await rawDb.user.findUnique({ where: { email }, include: { memberships: { select: { id: true }, take: 1 } } });
  if (user && !user.deletedAt && user.memberships.length > 0) {
    const token = await issueToken({ type: "PASSWORD_RESET", email, userId: user.id });
    await sendMail(passwordResetMail(email, { name: user.name, link: absoluteUrl(`/reset-password?token=${token}`), brand: mailBrand }));
  }
  return { ok: true, message: NEUTRAL };
}

/** Sets a new password from a reset link, signs the person out everywhere, and tells them by email. */
export async function resetPassword(raw: unknown): Promise<FlowResult> {
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { token, password } = parsed.data;

  // Check the password against the owner of the link BEFORE using the link up.
  const owner = await rawDb.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const user = owner?.userId ? await rawDb.user.findUnique({ where: { id: owner.userId } }) : null;
  if (!owner || owner.type !== "PASSWORD_RESET" || owner.usedAt || owner.revokedAt || owner.expiresAt <= new Date() || !user || user.deletedAt) {
    return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };
  }
  const problem = checkPassword(password, { email: user.email, name: user.name });
  if (problem) return { ok: false, error: problem, field: "password" };

  const passwordHash = await hashPassword(password);
  const done = await rawDb.$transaction(async (tx) => {
    const claimed = await claimToken(tx, token, "PASSWORD_RESET");
    if (!claimed || claimed.userId !== user.id) return false;
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 }, // every existing session stops working
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(), // they just proved they own the address
      },
    });
    return true;
  });
  if (!done) return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };

  await revokeTokens({ type: "PASSWORD_RESET", userId: user.id });
  const membership = await rawDb.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId: user.id, organizationId: membership?.organizationId ?? null, action: "PASSWORD_RESET", module: "AUTH", entityId: user.id });
  await sendMail(passwordChangedMail(user.email, { name: user.name, brand: mailBrand }));
  return { ok: true };
}
