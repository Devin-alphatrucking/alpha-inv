import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

/** One password rule for every place a password is set (sign-up, reset, invite, admin-created users). */
export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt only reads the first 72 bytes, so longer passwords would silently be cut. */
export const MAX_PASSWORD_BYTES = 72;

const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd123", "1234567890", "12345678910",
  "qwertyuiop", "qwerty12345", "qwerty123456", "1q2w3e4r5t", "iloveyou123", "welcome123",
  "welcome1234", "admin12345", "administrator", "letmein1234", "changeme123", "changeme1234",
  "abcdefghij", "abc1234567", "0123456789", "9876543210", "1111111111", "0000000000",
  "trustno1234", "monkey12345", "dragon12345", "football123", "baseball123", "sunshine123",
]);

export type PasswordContext = { email?: string | null; name?: string | null };

/** Returns a plain-language problem, or null when the password is acceptable. */
export function checkPassword(password: string, ctx: PasswordContext = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return "That password is too long (72 characters at most).";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose something harder to guess.";
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character.";
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "The password must not contain your email address.";
  const first = ctx.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower === first) return "The password must not be just your name.";
  return null;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

// When the email is unknown we still run a real bcrypt comparison (against a throwaway hash),
// so "no such user" and "wrong password" take the same time.
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= bcrypt.hash(randomBytes(16).toString("hex"), 12));

export async function verifyPassword(password: string, hash: string | null | undefined) {
  const ok = await bcrypt.compare(password, hash ?? (await dummyHash()));
  return Boolean(hash) && ok;
}
