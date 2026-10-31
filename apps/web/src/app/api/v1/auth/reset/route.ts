import { resetPasswordWithCode } from "@/lib/flows/verify-reset";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Set a new password with the code from the reset email. */
export const POST = route("/api/v1/auth/reset", async (req) => {
  const r = await resetPasswordWithCode(await readJson(req), { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(400, "invalid_input", r.error);
  return json({ ok: true });
});
