import { confirmEmailWithCode } from "@/lib/flows/verify-reset";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Confirm the email with the 6-digit code. The app then signs in with the password the person just typed. */
export const POST = route("/api/v1/auth/confirm", async (req) => {
  const body = (await readJson(req)) as { email?: unknown; code?: unknown };
  const r = await confirmEmailWithCode(body.email, body.code, { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(400, "invalid_code", r.error);
  return json({ ok: true });
});
