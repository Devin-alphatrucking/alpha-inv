import { flow, json, need, notFound, readJson, requireMobile, route } from "@/lib/mobile/http";
import { getDelivery, recordReceipt } from "@/lib/flows/delivery";
import { companyToday } from "@/lib/flows/site";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ orderId: string }> };

/** The order's items with ordered / received / refused / still to come, and the deliveries recorded so far. No prices. */
export const GET = route<Ctx>("/api/v1/deliveries/[orderId]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "delivery:view");
  const delivery = await getDelivery(me, (await ctx.params).orderId);
  return delivery ? json({ delivery, today: await companyToday(me.orgId) }) : notFound("Order");
});

/** POST { receivedOn, challanNo, note, lines: [{ orderLineId, quantity, rejected, remark }] }: records one delivery. Add photos with POST /api/v1/site/photos (receiptId). */
export const POST = route<Ctx>("/api/v1/deliveries/[orderId]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "delivery:write");
  const body = (await readJson(req)) as Record<string, unknown>;
  return flow(await recordReceipt(me, (await ctx.params).orderId, body, body.clientRef), 201);
});
