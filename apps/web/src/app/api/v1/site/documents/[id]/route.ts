import { json, need, notFound, requireMobile, route } from "@/lib/mobile/http";
import { getDocument } from "@/lib/flows/documents";

export const runtime = "nodejs";

/** One drawing with all its revisions (newest first). */
export const GET = route<{ params: Promise<{ id: string }> }>("/api/v1/site/documents/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const document = await getDocument(me, (await ctx.params).id);
  return document ? json({ document }) : notFound("Drawing");
});
