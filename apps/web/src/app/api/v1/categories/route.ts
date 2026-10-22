import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";

export const runtime = "nodejs";

/** Categories to choose from when uploading an invoice. */
export const GET = route("/api/v1/categories", async (req) => {
  const me = await requireMobile(req);
  const categories = await dbFor(me.orgId).category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return json({ categories });
});
