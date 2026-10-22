import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "@/lib/db";
import type { AuthTokenType, Role } from "@alpha/db";

/**
 * One-time links sent by email. The link carries a random 256-bit token; the database
 * keeps only its SHA-256, so a database leak does not leak working links. Every token
 * is single-use and expires.
 */
export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
  INVITE: 7 * 24 * 60 * 60 * 1000,
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export type IssueInput = {
  type: AuthTokenType;
  email: string;
  userId?: string | null;
  organizationId?: string | null;
  role?: Role | null;
  payload?: Record<string, unknown>;
  createdById?: string | null;
  /** Override the default lifetime (tests). */
  ttlMs?: number;
};

/** Creates a link token and returns the RAW token (to put in the email). Earlier unused tokens of the same kind for the same address (and company) are cancelled. */
export async function issueToken(input: IssueInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const { token, hash } = newToken();
  await rawDb.$transaction([
    rawDb.authToken.updateMany({
      where: {
        type: input.type,
        email,
        organizationId: input.organizationId ?? null,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
    rawDb.authToken.create({
      data: {
        type: input.type,
        tokenHash: hash,
        email,
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        role: input.role ?? null,
        payload: (input.payload ?? undefined) as never,
        createdById: input.createdById ?? null,
        expiresAt: new Date(Date.now() + (input.ttlMs ?? TOKEN_TTL_MS[input.type])),
      },
    }),
  ]);
  return token;
}

/** Looks a token up without using it. Null when unknown, used, cancelled or expired. */
export async function peekToken(raw: string | null | undefined, type: AuthTokenType) {
  if (!raw || raw.length < 20 || raw.length > 100) return null;
  const row = await rawDb.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row || row.type !== type || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) return null;
  return row;
}

/** Uses a token exactly once, even if two requests race. Returns its row, or null if it cannot be used. */
export async function consumeToken(raw: string | null | undefined, type: AuthTokenType) {
  if (!raw || raw.length < 20 || raw.length > 100) return null;
  const hash = hashToken(raw);
  const claimed = await rawDb.authToken.updateMany({
    where: { tokenHash: hash, type, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return rawDb.authToken.findUnique({ where: { tokenHash: hash } });
}

/** Cancels every unused token of a kind for a person (for example after a password change). */
export function revokeTokens(where: { type: AuthTokenType; userId?: string; email?: string; organizationId?: string }) {
  return rawDb.authToken.updateMany({
    where: { ...where, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

type TokenTx = { authToken: Pick<typeof rawDb.authToken, "updateMany" | "findUnique"> };

/** Like consumeToken, but inside a caller's transaction, so using the link and the work it unlocks succeed or fail together. */
export async function claimToken(tx: TokenTx, raw: string | null | undefined, type: AuthTokenType) {
  if (!raw || raw.length < 20 || raw.length > 100) return null;
  const hash = hashToken(raw);
  const claimed = await tx.authToken.updateMany({
    where: { tokenHash: hash, type, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return tx.authToken.findUnique({ where: { tokenHash: hash } });
}
