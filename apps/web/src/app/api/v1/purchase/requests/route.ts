import { flow, json, need, readJson, requireMobile, route } from "@/lib/mobile/http";
import { listRequests, purchaseOverview, saveRequest, submitRequest } from "@/lib/flows/purchase";
import { REQUEST_LABEL, type RequestState } from "@/lib/purchase/rules";

export const runtime = "nodejs";

const STATES = Object.keys(REQUEST_LABEL) as RequestState[];

/** GET ?projectId=&status=SUBMITTED,APPROVED: material requests the person may see, newest first, with counts. */
export const GET = route("/api/v1/purchase/requests", async (req) => {
  const me = await requireMobile(req);
  need(me, "request:view");
  const sp = new URL(req.url).searchParams;
  const wanted = (sp.get("status") ?? "").split(",").filter((s): s is RequestState => (STATES as string[]).includes(s));
  const [requests, overview] = await Promise.all([listRequests(me, { projectId: sp.get("projectId"), status: wanted.length ? wanted : undefined, take: 100 }), purchaseOverview(me)]);
  return json({ requests, waitingForApproval: overview.waitingForApproval, approvedToOrder: overview.approvedToOrder });
});

/** POST { projectId, neededBy, note, lines: [{ description, unit, quantity }], submit?: true }: raises a request (saved as a draft, or sent for approval at once). */
export const POST = route("/api/v1/purchase/requests", async (req) => {
  const me = await requireMobile(req);
  need(me, "request:write");
  const body = (await readJson(req)) as Record<string, unknown>;
  const saved = await saveRequest(me, { projectId: typeof body.projectId === "string" ? body.projectId : "", data: body, clientRef: body.clientRef });
  if (!saved.ok) return flow(saved);
  if (body.submit === true) {
    const sent = await submitRequest(me, saved.id);
    if (!sent.ok) return json({ ok: true, id: saved.id, number: saved.number, submitted: false, warning: sent.error }, 201);
  }
  return json({ ok: true, id: saved.id, number: saved.number, submitted: body.submit === true }, 201);
});
