import { requestPasswordReset } from "@/lib/flows/verify-reset";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Email a password-reset code. The answer never says whether the address has an account. */
export const POST = route("/api/v1/auth/forgot", async (req) => {
  const body = (await readJson(req)) as { email?: unknown };
  const r = await requestPasswordReset(body.email, { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(400, "invalid_input", r.error);
  return json({ message: r.message });
});
