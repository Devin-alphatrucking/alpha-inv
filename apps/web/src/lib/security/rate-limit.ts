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

/**
 * The caller's IP. A client can put anything at the START of X-Forwarded-For, and proxies APPEND the address they saw, so the
 * first entry is not trustworthy. We count TRUSTED_PROXY_HOPS (default 1: one proxy such as Cloudflare or a load balancer) from the
 * END of the list instead. Cloudflare's own header wins when present. Set TRUSTED_PROXY_HOPS=0 when the app faces the internet directly.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  const list = (headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list.length && Number.isInteger(hops) && hops >= 1) return list[Math.max(0, list.length - hops)] ?? "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}
