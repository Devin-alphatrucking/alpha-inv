import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";

export const runtime = "nodejs";

/** All suppliers of the company with how many invoices each has. GET ?q= filters by name or GSTIN. */
export const GET = route("/api/v1/vendors", async (req) => {
  const me = await requireMobile(req);
  need(me, "vendor:view");
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80);
  const vendors = await dbFor(me.orgId).vendor.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { gstin: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { name: "asc" },
    take: 300,
    select: { id: true, name: true, gstin: true, _count: { select: { invoices: true } } },
  });
  return json({ vendors: vendors.map((v) => ({ id: v.id, name: v.name, gstin: v.gstin, invoiceCount: v._count.invoices })) });
});
