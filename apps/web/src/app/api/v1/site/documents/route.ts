import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { listDocuments } from "@/lib/flows/documents";

export const runtime = "nodejs";

/** GET ?projectId=&category=&q=: the drawings and documents the person may see, each with its current revision. */
export const GET = route("/api/v1/site/documents", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const sp = new URL(req.url).searchParams;
  return json({ documents: await listDocuments(me, { projectId: sp.get("projectId"), category: sp.get("category"), q: sp.get("q") }) });
});
