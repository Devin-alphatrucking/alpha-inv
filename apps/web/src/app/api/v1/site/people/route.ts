import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { assignableUsers } from "@/lib/flows/site";

export const runtime = "nodejs";

/** GET ?projectId=: people an issue on that project can be given to. */
export const GET = route("/api/v1/site/people", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:write");
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  return json({ people: await assignableUsers(me, projectId) });
});
