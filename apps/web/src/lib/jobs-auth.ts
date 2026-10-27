import { timingSafeEqual } from "node:crypto";

/** The scheduler's pass for /api/jobs/*: "Authorization: Bearer <JOBS_SECRET>". With no secret of 16+ characters the jobs are switched off. */
export function jobsAllowed(req: Request): boolean {
  const secret = process.env.JOBS_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), "utf8");
  const want = Buffer.from(secret, "utf8");
  return given.length === want.length && timingSafeEqual(given, want);
}
