import { refreshMobile } from "@/lib/mobile/sessions";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export const POST = route("/api/v1/auth/refresh", async (req) => {
  const body = (await readJson(req)) as { refreshToken?: unknown };
  const r = await refreshMobile(body.refreshToken, { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(r.status, r.code, r.error);
  return json({ tokens: r.tokens });
});
