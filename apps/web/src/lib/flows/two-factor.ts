import { rawDb } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { confirmPassword } from "@/lib/flows/account";
import type { FlowResult } from "@/lib/flows/schemas";
import { generateSecret, hashRecoveryCode, newRecoveryCodes, normalizeRecoveryCode, otpauthUri, verifyTotp } from "@/lib/security/totp";

/**
 * Two-step sign-in with an authenticator app (see lib/security/totp.ts).
 *  - setup: a secret is created and stored ENCRYPTED but does not count until the person proves their app shows the right code
 *  - once enabled, sign-in needs the password AND a current code (or a single-use recovery code)
 *  - each code works once; wrong codes are rate limited per person
 */

const ATTEMPTS = { limit: 10, windowSeconds: 900 };

async function attemptsOk(userId: string) {
  return hit(limitKey("totp:user", userId), ATTEMPTS.limit, ATTEMPTS.windowSeconds);
}

export async function twoFactorStatus(userId: string) {
  const u = await rawDb.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, isPlatformAdmin: true } });
  const left = u?.totpEnabledAt ? await rawDb.recoveryCode.count({ where: { userId, usedAt: null } }) : 0;
  return { enabled: Boolean(u?.totpEnabledAt), enabledAt: u?.totpEnabledAt ?? null, recoveryLeft: left, isOperator: Boolean(u?.isPlatformAdmin) };
}

/** Step 1: make a secret. Safe to call again before confirming (a new secret replaces the unconfirmed one). */
export async function beginTwoFactorSetup(userId: string): Promise<FlowResult<{ secret: string; uri: string }>> {
  const user = await rawDb.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) return { ok: false, error: "Account not found." };
  if (user.totpEnabledAt) return { ok: false, error: "Two-step sign-in is already on." };
  const secret = generateSecret();
  await rawDb.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptSecret(secret), totpLastStep: null } });
  return { ok: true, secret, uri: otpauthUri(PRODUCT_NAME, user.email, secret) };
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await rawDb.$transaction([
    rawDb.recoveryCode.deleteMany({ where: { userId } }),
    rawDb.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) }),
  ]);
  return codes;
}

/** Step 2: the person types the code their app shows. Turns it on and returns the recovery codes (shown once, never again). */
export async function confirmTwoFactorSetup(userId: string, code: string): Promise<FlowResult<{ recoveryCodes: string[] }>> {
  const limit = await attemptsOk(userId);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };
  const user = await rawDb.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || !user.totpSecretEnc) return { ok: false, error: "Start the setup again." };
  if (user.totpEnabledAt) return { ok: false, error: "Two-step sign-in is already on." };
  const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, new Date());
  if (step === null) return { ok: false, error: "That code is not right. Check the code in your app (it changes every 30 seconds) and try again.", field: "code" };

  await rawDb.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
  const recoveryCodes = await replaceRecoveryCodes(userId);
  const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "TWO_STEP_ENABLED", module: "AUTH", entityId: userId });
  return { ok: true, recoveryCodes };
}

/**
 * Checks the second factor at sign-in: a current app code, or an unused recovery code (which is then used up).
 * Returns false for anything else. The caller has already checked the password.
 */
export async function checkSecondFactor(userId: string, input: string, now: Date = new Date()): Promise<{ ok: true; usedRecoveryCode: boolean } | { ok: false; reason: "invalid" | "rate_limited" | "not_enabled" }> {
  const user = await rawDb.user.findUnique({ where: { id: userId }, select: { totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true } });
  if (!user?.totpEnabledAt || !user.totpSecretEnc) return { ok: false, reason: "not_enabled" };
  const limit = await attemptsOk(userId);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  const step = verifyTotp(decryptSecret(user.totpSecretEnc), input, now, user.totpLastStep);
  if (step !== null) {
    // Claim the step: of two requests presenting the same code at once, only one wins.
    const claimed = await rawDb.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    if (claimed.count === 1) return { ok: true, usedRecoveryCode: false };
    return { ok: false, reason: "invalid" };
  }

  const recovery = normalizeRecoveryCode(input);
  if (recovery) {
    const used = await rawDb.recoveryCode.updateMany({ where: { userId, codeHash: hashRecoveryCode(recovery), usedAt: null }, data: { usedAt: now } });
    if (used.count === 1) {
      const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
      await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "RECOVERY_CODE_USED", module: "AUTH", entityId: userId });
      return { ok: true, usedRecoveryCode: true };
    }
  }
  return { ok: false, reason: "invalid" };
}

/** Turning it off needs the password AND a current code (or recovery code): a stolen session alone cannot remove the protection. */
export async function disableTwoFactor(userId: string, password: string, code: string): Promise<FlowResult> {
  const check = await confirmPassword(userId, password);
  if (!check.ok) return check;
  if (!check.user.totpEnabledAt) return { ok: false, error: "Two-step sign-in is not on." };
  const second = await checkSecondFactor(userId, code);
  if (!second.ok) return { ok: false, error: second.reason === "rate_limited" ? "Too many tries. Please wait and try again." : "That code is not right.", field: "code" };

  await rawDb.$transaction([
    rawDb.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } }),
    rawDb.recoveryCode.deleteMany({ where: { userId } }),
  ]);
  const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "TWO_STEP_DISABLED", module: "AUTH", entityId: userId });
  return { ok: true };
}

/** New recovery codes (the old ones stop working). Needs the password and a current code. */
export async function regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<FlowResult<{ recoveryCodes: string[] }>> {
  const check = await confirmPassword(userId, password);
  if (!check.ok) return check;
  if (!check.user.totpEnabledAt) return { ok: false, error: "Two-step sign-in is not on." };
  const second = await checkSecondFactor(userId, code);
  if (!second.ok) return { ok: false, error: second.reason === "rate_limited" ? "Too many tries. Please wait and try again." : "That code is not right.", field: "code" };
  const recoveryCodes = await replaceRecoveryCodes(userId);
  const membership = await rawDb.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  await logActivity({ userId, organizationId: membership?.organizationId ?? null, action: "RECOVERY_CODES_RESET", module: "AUTH", entityId: userId });
  return { ok: true, recoveryCodes };
}
