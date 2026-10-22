import { createHash } from "node:crypto";
import { rawDb } from "@/lib/db";

/**
 * Abuse limits shared by every server instance (kept in Postgres). A fixed window per key:
 * the first hit opens the window; once `limit` hits land inside it, further hits are refused
 * until it ends. Every hit counts, allowed or not.
 */
export type RateResult = { allowed: boolean; count: number; retryAfterSeconds: number };

/** Short, non-reversible id for an email/IP, so addresses are not stored in the limit table. */
export function limitKey(scope: string, identifier: string) {
  return `${scope}:${createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

export async function hit(key: string, limit: number, windowSeconds: number): Promise<RateResult> {
  const rows = await rawDb.$queryRaw<{ count: number; retry: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${windowSeconds}::double precision)
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${windowSeconds}::double precision)
                           THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"::int AS "count",
              GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${windowSeconds}::double precision) - now()))))::int AS "retry"`;
  const row = rows[0];
  // tidy old rows now and then (keeps the table small without a scheduled job)
  if (Math.random() < 0.01) {
    void rawDb.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '2 days'`.catch(() => undefined);
  }
  return { allowed: row.count <= limit, count: row.count, retryAfterSeconds: row.retry };
}

/** Checks several limits at once; refused if ANY is exceeded. */
export async function hitAll(checks: { key: string; limit: number; windowSeconds: number }[]): Promise<RateResult> {
  let result: RateResult = { allowed: true, count: 0, retryAfterSeconds: 0 };
  for (const c of checks) {
    const r = await hit(c.key, c.limit, c.windowSeconds);
    if (!r.allowed) {
      if (result.allowed || r.retryAfterSeconds > result.retryAfterSeconds) result = r;
    } else if (result.allowed) {
      result = r;
    }
  }
  return result;
}

export function retryMessage(seconds: number) {
  const mins = Math.ceil(seconds / 60);
  return mins <= 1 ? "Too many attempts. Please wait a minute and try again." : `Too many attempts. Please try again in about ${mins} minutes.`;
}

/** The caller's IP as reported by the proxy in front of the app. Only trust this behind a proxy you control. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
