import { json, need, readJson, requireMobile, route } from "@/lib/mobile/http";
import { AppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { dbFor } from "@/lib/org/scoped-db";

export const runtime = "nodejs";

/** Categories to choose from when uploading an invoice. */
export const GET = route("/api/v1/categories", async (req) => {
  const me = await requireMobile(req);
  const categories = await dbFor(me.orgId).category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return json({ categories });
});

/** POST { name }: adds a category while uploading ("Or create a new category"). An existing category of the same name is returned instead of a second one. */
export const POST = route("/api/v1/categories", async (req) => {
  const me = await requireMobile(req);
  need(me, "invoice:upload");
  const body = (await readJson(req)) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) throw new AppError("VALIDATION_001", "Category name is required");
  const db = dbFor(me.orgId);
  const existing = await db.category.findFirst({ where: { name }, select: { id: true, name: true } });
  if (existing) return json({ category: existing, created: false });
  const created = await db.category.create({ data: { organizationId: me.orgId, name }, select: { id: true, name: true } });
  await logActivity({ userId: me.id, organizationId: me.orgId, action: "CATEGORY_CREATED", module: "CATEGORY", entityId: created.id, details: { name: created.name } });
  return json({ category: created, created: true }, 201);
});
