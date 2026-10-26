import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { siteOverview } from "@/lib/flows/site";

export const runtime = "nodejs";

/** For each project the person may see: is today's report written, and how many issues are open or late. */
export const GET = route("/api/v1/site/overview", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  return json(await siteOverview(me));
});
