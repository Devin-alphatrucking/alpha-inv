import { switchCompanyMobile } from "@/lib/mobile/sessions";
import { apiError, json, readJson, requireMobile, route } from "@/lib/mobile/http";

export const runtime = "nodejs";

export const POST = route("/api/v1/me/company", async (req) => {
  const me = await requireMobile(req);
  const body = (await readJson(req)) as { companyId?: unknown };
  const r = await switchCompanyMobile(me.sessionId, me.id, body.companyId);
  return r.ok ? json({ companyId: r.orgId }) : apiError(r.status, r.code, r.error);
});
