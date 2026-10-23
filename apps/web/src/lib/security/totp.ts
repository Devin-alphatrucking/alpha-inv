import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238, HMAC-SHA1, 6 digits, 30 seconds): the codes shown by Google Authenticator, Microsoft
// Authenticator, Authy, 1Password and similar apps. Pure functions, tested against the RFC's own test values.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PERIOD_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, as the base32 text people type into an app. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (now: Date) => Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);

export function totpAt(secret: string, now: Date, digits = DIGITS): string {
  return hotp(base32Decode(secret), stepOf(now), digits);
}

/**
 * Checks a code against the current 30-second step and one step either side (clocks drift). Returns the step that matched, so
 * the caller can refuse to accept the same code twice (`lastUsedStep`), or null.
 */
export function verifyTotp(secret: string, code: string, now: Date = new Date(), lastUsedStep: number | null = null, window = 1): number | null {
  const clean = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  const current = stepOf(now);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const want = Buffer.from(hotp(key, step));
    const got = Buffer.from(clean);
    // every step is compared (no early exit), so timing does not reveal which one was close
    if (want.length === got.length && timingSafeEqual(want, got) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && matched <= lastUsedStep) return null; // a code can be used once
  return matched;
}

/** The link an authenticator app opens (or encodes in a QR code). */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

// ---- recovery codes: for a lost phone. Shown once, stored only as hashes, each works once.

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** What the person typed, in the stored form (capitals, no spaces, with the dash). Returns null when it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 10) return null;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export const hashRecoveryCode = (code: string) => createHash("sha256").update(code).digest("hex");
