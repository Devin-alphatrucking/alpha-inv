import { logoutMobile } from "@/lib/mobile/sessions";
import { json, requireMobile, route } from "@/lib/mobile/http";

export const runtime = "nodejs";

export const POST = route("/api/v1/auth/logout", async (req) => {
  const me = await requireMobile(req);
  await logoutMobile(me.sessionId, me.id);
  return json({ ok: true });
});
