import { flow, json, need, notFound, readJson, requireMobile, route } from "@/lib/mobile/http";
import { cancelRequest, decideRequest, getRequest, saveRequest, submitRequest, withdrawRequest } from "@/lib/flows/purchase";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** One request with its items, and `actions`: what this person may do with it now. */
export const GET = route<Ctx>("/api/v1/purchase/requests/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "request:view");
  const request = await getRequest(me, (await ctx.params).id);
  return request ? json({ request }) : notFound("Request");
});

/** PUT { neededBy, note, lines }: changes a draft. */
export const PUT = route<Ctx>("/api/v1/purchase/requests/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "request:write");
  const { id } = await ctx.params;
  const existing = await getRequest(me, id);
  if (!existing) return notFound("Request");
  return flow(await saveRequest(me, { requestId: id, projectId: existing.projectId, data: await readJson(req) }));
});

/** POST { action: "submit" | "withdraw" | "cancel" | "approve" | "reject", note? }. */
export const POST = route<Ctx>("/api/v1/purchase/requests/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "request:view");
  const { id } = await ctx.params;
  const { action, note } = (await readJson(req)) as { action?: string; note?: unknown };
  switch (action) {
    case "submit": return flow(await submitRequest(me, id));
    case "withdraw": return flow(await withdrawRequest(me, id));
    case "cancel": return flow(await cancelRequest(me, id));
    case "approve": return flow(await decideRequest(me, id, true, note));
    case "reject": return flow(await decideRequest(me, id, false, note));
    default: return flow({ ok: false, error: "Unknown action.", field: "action" });
  }
});
