// One-time email codes: the rules that need no database. Pure functions, unit-tested (otp.test.ts).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_TRIES = 5;
/** A second code cannot be asked for sooner than this after the last one (stops a mail flood and a quick re-roll of guesses). */
export const OTP_RESEND_SECONDS = 30;
/** After a person confirms with a code, risky actions need no new code for this long. */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

export type OtpPurpose = "SIGNUP" | "PASSWORD_RESET" | "CONFIRM_ACTION";

/** Six random digits, every code equally likely (leading zeros kept). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

/** What a person typed, as digits only ("123 456" and "123-456" are fine), or null when it cannot be a code. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]+/g, "");
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(digits) ? digits : null;
}

/** Only this is stored: a keyed hash tied to the code's own id, purpose and address, so a stolen row cannot be tried offline without the server's secret. */
export function hashCode(secret: string, id: string, purpose: OtpPurpose, email: string, code: string): string {
  return createHmac("sha256", secret).update(`${id}|${purpose}|${email.trim().toLowerCase()}|${code}`).digest("hex");
}

export function codesMatch(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(actualHash, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** "123 456" for reading out of an email. */
export const displayCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export type OtpFailure = "none" | "expired" | "locked" | "wrong";

/** What to tell the person, never revealing more than needed. `triesLeft` only matters for a wrong code. */
export function failureMessage(reason: OtpFailure, triesLeft = 0): string {
  switch (reason) {
    case "wrong":
      return triesLeft > 0 ? `That code is not right. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.` : "That code is not right. Ask for a new code.";
    case "locked":
      return "Too many wrong codes. Ask for a new code.";
    case "expired":
      return "That code has expired. Ask for a new code.";
    default:
      return "That code is not right, or it has expired. Ask for a new code.";
  }
}
