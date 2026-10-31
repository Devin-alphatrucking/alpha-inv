import { z } from "zod";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { rawDb } from "@/lib/db";
import { resolveGoogleSignIn } from "@/lib/flows/google";
import { GOOGLE_MESSAGES } from "@/lib/flows/google-messages";
import { loadDefaultMembership } from "@/lib/org/membership-load";
import { startSession, type MobileResult, type Tokens } from "./sessions";

/**
 * Sign in or sign up from the phone with Google. The app gets a Google ID token from the phone's own Google sign-in and sends it here;
 * we ask Google whether it is genuine and meant for OUR app (the audience must be one of our client ids), then apply exactly the same
 * rules as the website's Google button (resolveGoogleSignIn): confirmed address only, two-step accounts must use their password, and
 * a new person gets a company on a free trial.
 */

const bodySchema = z.object({
  idToken: z.string().min(20).max(4000),
  deviceName: z.string().trim().max(80).optional(),
  platform: z.enum(["ios", "android"]).optional(),
  appVersion: z.string().trim().max(30).optional(),
});

/** Client ids our apps may use: GOOGLE_MOBILE_CLIENT_IDS (comma separated: the Android, iOS and web ids) and the website's own. */
export function allowedGoogleAudiences() {
  return [process.env.GOOGLE_MOBILE_CLIENT_IDS, process.env.GOOGLE_CLIENT_ID]
    .flatMap((v) => (v ?? "").split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isGoogleMobileConfigured() {
  return allowedGoogleAudiences().length > 0;
}

type TokenInfo = { aud?: string; iss?: string; exp?: string; email?: string; email_verified?: string | boolean; name?: string };

async function checkWithGoogle(idToken: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as TokenInfo;
  } catch {
    return null;
  }
}

export async function googleLoginMobile(raw: unknown, ctx: { ip: string }): Promise<MobileResult<{ tokens: Tokens; created: boolean }>> {
  const fail = (status: number, code: string, error: string) => ({ ok: false as const, status, code, error });
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_input", GOOGLE_MESSAGES.failed);
  if (!isGoogleMobileConfigured()) return fail(503, "google_off", "Google sign-in is not set up on this server.");

  const limit = await hitAll([{ key: limitKey("google:mobile:ip", ctx.ip), limit: 30, windowSeconds: 900 }]);
  if (!limit.allowed) return fail(429, "rate_limited", retryMessage(limit.retryAfterSeconds));

  const info = await checkWithGoogle(parsed.data.idToken);
  const issuerOk = info?.iss === "accounts.google.com" || info?.iss === "https://accounts.google.com";
  const expired = !info?.exp || Number(info.exp) * 1000 <= Date.now();
  if (!info || !issuerOk || expired || !info.aud || !allowedGoogleAudiences().includes(info.aud)) return fail(401, "google_invalid", GOOGLE_MESSAGES.failed);

  const result = await resolveGoogleSignIn({ email: info.email, email_verified: info.email_verified === true || info.email_verified === "true", name: info.name });
  if (!result.ok) return fail(result.reason === "busy" ? 429 : 403, `google_${result.reason}`, GOOGLE_MESSAGES[result.reason]);

  const user = await rawDb.user.findUnique({ where: { id: result.userId }, select: { id: true, sessionVersion: true } });
  const membership = await loadDefaultMembership(result.userId);
  if (!user || !membership) return fail(403, "no_company", GOOGLE_MESSAGES.no_company);
  const started = await startSession(user, membership.organizationId, parsed.data, ctx, "google");
  return { ok: true, tokens: started.tokens, created: result.created };
}
