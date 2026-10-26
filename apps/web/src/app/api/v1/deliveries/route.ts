import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { listDeliveries } from "@/lib/flows/delivery";

export const runtime = "nodejs";

/** GET ?all=1: orders sent to suppliers that are waiting for goods (all=1 also lists the fully received ones). No prices. */
export const GET = route("/api/v1/deliveries", async (req) => {
  const me = await requireMobile(req);
  need(me, "delivery:view");
  const all = new URL(req.url).searchParams.get("all") === "1";
  return json({ deliveries: await listDeliveries(me, { includeComplete: all }) });
});
