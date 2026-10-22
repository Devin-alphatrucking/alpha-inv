import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { AppError } from "@/lib/errors";

/**
 * AES-256-GCM helpers for secrets stored in the database (per-project Azure
 * keys). The master key lives only in the APP_ENCRYPTION_KEY env var
 * (base64, 32 bytes) and never in the repo or the database.
 *
 * Stored format: "v1:<iv>:<tag>:<ciphertext>" (all base64).
 */
const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new AppError(
      "CONFIG_001",
      "APP_ENCRYPTION_KEY is not set on the server, so project keys cannot be saved or read."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new AppError(
      "CONFIG_001",
      "APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded."
    );
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new AppError("CONFIG_001", "Stored project key is in an unknown format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "CONFIG_001",
      "Stored project key could not be decrypted. Re-enter it in the project settings."
    );
  }
}
