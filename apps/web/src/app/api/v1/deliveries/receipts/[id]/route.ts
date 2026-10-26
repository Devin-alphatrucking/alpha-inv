import { flow, need, requireMobile, route } from "@/lib/mobile/http";
import { deleteReceipt } from "@/lib/flows/delivery";

export const runtime = "nodejs";

/** DELETE: remove a delivery record (the person who recorded it within a day, or the purchase officer). */
export const DELETE = route<{ params: Promise<{ id: string }> }>("/api/v1/deliveries/receipts/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "delivery:write");
  return flow(await deleteReceipt(me, (await ctx.params).id));
});
