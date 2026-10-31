import { googleLoginMobile } from "@/lib/mobile/google";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Sign in or sign up with a Google ID token from the phone. */
export const POST = route("/api/v1/auth/google", async (req) => {
  const r = await googleLoginMobile(await readJson(req), { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(r.status, r.code, r.error);
  return json({ tokens: r.tokens, created: r.created });
});
