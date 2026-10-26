import { randomUUID } from "node:crypto";
import { rawDb } from "@/lib/db";
import { cleanCode, codesMatch, failureMessage, generateCode, hashCode, OTP_MAX_TRIES, OTP_RESEND_SECONDS, OTP_TTL_MS, STEP_UP_WINDOW_MS, type OtpFailure, type OtpPurpose } from "./otp-rules";

/**
 * One-time email codes. A code lives 10 minutes, allows 5 tries and works once. Asking for a new one cancels the earlier one.
 * Only a keyed hash is stored. This file talks to the database; the rules are in otp-rules.ts.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.APP_ENCRYPTION_KEY;
  if (!s) throw new Error("AUTH_SECRET must be set to issue one-time codes.");
  return s;
}

const norm = (email: string) => email.trim().toLowerCase();

export type IssueResult = { ok: true; code: string } | { ok: false; error: string; retryAfterSeconds: number };

/** Creates a code for an address and purpose. Refused if the last one was sent less than OTP_RESEND_SECONDS ago. */
export async function issueOtp(input: { purpose: OtpPurpose; email: string; userId?: string | null; now?: Date }): Promise<IssueResult> {
  const now = input.now ?? new Date();
  const email = norm(input.email);
  const last = await rawDb.otpCode.findFirst({ where: { purpose: input.purpose, email, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last) {
    const wait = Math.ceil((last.createdAt.getTime() + OTP_RESEND_SECONDS * 1000 - now.getTime()) / 1000);
    if (wait > 0) return { ok: false, error: `Wait ${wait} second${wait === 1 ? "" : "s"} before asking for another code.`, retryAfterSeconds: wait };
  }
  const code = generateCode();
  const id = randomUUID();
  await rawDb.$transaction([
    rawDb.otpCode.updateMany({ where: { purpose: input.purpose, email, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
    rawDb.otpCode.create({
      data: { id, purpose: input.purpose, email, userId: input.userId ?? null, codeHash: hashCode(secret(), id, input.purpose, email, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), createdAt: now },
    }),
  ]);
  return { ok: true, code };
}

export type VerifyResult = { ok: true; userId: string | null } | { ok: false; reason: OtpFailure; error: string };

/**
 * Checks a code. Every wrong try counts (atomically, so parallel guesses cannot beat the limit); the right one is used up
 * so it cannot be used twice. `userId`, when given, must match the person the code was issued to.
 */
export async function verifyOtp(input: { purpose: OtpPurpose; email: string; code: unknown; userId?: string | null; now?: Date }): Promise<VerifyResult> {
  const now = input.now ?? new Date();
  const email = norm(input.email);
  const fail = (reason: OtpFailure, triesLeft = 0): VerifyResult => ({ ok: false, reason, error: failureMessage(reason, triesLeft) });

  const typed = cleanCode(input.code);
  if (!typed) return fail("none");
  const row = await rawDb.otpCode.findFirst({
    where: { purpose: input.purpose, email, usedAt: null, revokedAt: null, ...(input.userId ? { userId: input.userId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return fail("none");
  if (row.expiresAt <= now) return fail("expired");

  // Count this try first. If another request used up the last try meanwhile, nothing is counted and we say locked.
  const counted = await rawDb.otpCode.updateMany({ where: { id: row.id, usedAt: null, revokedAt: null, attempts: { lt: OTP_MAX_TRIES } }, data: { attempts: { increment: 1 } } });
  if (counted.count === 0) return fail("locked");

  if (!codesMatch(row.codeHash, hashCode(secret(), row.id, input.purpose, email, typed))) return fail("wrong", Math.max(0, OTP_MAX_TRIES - (row.attempts + 1)));

  const used = await rawDb.otpCode.updateMany({ where: { id: row.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
  if (used.count !== 1) return fail("none");
  return { ok: true, userId: row.userId };
}

/** Whether this person confirmed a code for a risky action in the last 15 minutes (one code covers a burst of risky actions). */
export async function recentlyConfirmed(userId: string, now: Date = new Date()): Promise<boolean> {
  const row = await rawDb.otpCode.findFirst({ where: { purpose: "CONFIRM_ACTION", userId, usedAt: { gte: new Date(now.getTime() - STEP_UP_WINDOW_MS) } }, select: { id: true } });
  return Boolean(row);
}
