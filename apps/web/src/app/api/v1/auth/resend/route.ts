import { resendVerification } from "@/lib/flows/verify-reset";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Send a new confirmation code. */
export const POST = route("/api/v1/auth/resend", async (req) => {
  const body = (await readJson(req)) as { email?: unknown };
  const r = await resendVerification(body.email, { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(400, "invalid_input", r.error);
  return json({ message: r.message });
});
