import { rawDb } from "@/lib/db";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { confirmActionMail } from "@/lib/email/templates";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { issueOtp, recentlyConfirmed, verifyOtp } from "@/lib/security/otp";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * "Confirm it is you" before a risky action (removing a person, closing the company, deleting an account, recording a payment run).
 * The person asks for a code, gets it by email, types it. One confirmed code covers every risky action for the next 15 minutes,
 * so a burst of them (a pay run, then another) needs one code, not one each. If email is not set up on the server, the extra
 * step cannot be offered and the action goes ahead as before (the password and typed-word checks on the dangerous ones remain).
 */

/** A readable list of what needs a code, for the screens and for tests. */
export const STEP_UP_ACTIONS = ["Remove a person from the company", "Close the company", "Delete your account", "Record a payment run", "Change a colleague's password"] as const;

export type StepUpOutcome = { ok: true } | { ok: false; error: string; needsCode: true };

export async function sendStepUpCode(userId: string, action: string): Promise<FlowResult<{ sentTo: string }>> {
  if (!isEmailConfigured()) return { ok: false, error: "Email is not set up on this server, so a confirmation code cannot be sent." };
  const user = await rawDb.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, deletedAt: true } });
  if (!user || user.deletedAt) return { ok: false, error: "Account not found." };

  const limit = await hit(limitKey("stepup:user", user.id), 8, 3600);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  const otp = await issueOtp({ purpose: "CONFIRM_ACTION", email: user.email, userId: user.id });
  if (!otp.ok) return { ok: false, error: otp.error };
  await sendMail(confirmActionMail(user.email, { name: user.name, code: otp.code, action, brand: { name: PRODUCT_NAME } }));
  return { ok: true, sentTo: maskEmail(user.email) };
}

/** Whether the action may go ahead: confirmed in the last 15 minutes, or the right code was sent with it. */
export async function checkStepUp(userId: string, code: unknown): Promise<StepUpOutcome> {
  if (!isEmailConfigured()) return { ok: true };
  if (await recentlyConfirmed(userId)) return { ok: true };
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "Confirm it is you with the code we email you.", needsCode: true };
  const user = await rawDb.user.findUnique({ where: { id: userId }, select: { email: true, deletedAt: true } });
  if (!user || user.deletedAt) return { ok: false, error: "Account not found.", needsCode: true };
  const checked = await verifyOtp({ purpose: "CONFIRM_ACTION", email: user.email, code, userId });
  return checked.ok ? { ok: true } : { ok: false, error: checked.error, needsCode: true };
}

/** "a***@company.com": enough to recognise the inbox, not enough to reveal the address to someone looking over a shoulder. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "your email";
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}
