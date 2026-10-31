import { json, need, notFound, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";

export const runtime = "nodejs";

/** One supplier and the invoices of theirs this person may see (latest 50), with what is billed, paid and still owed. */
export const GET = route<{ params: Promise<{ id: string }> }>("/api/v1/vendors/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "vendor:view");
  const { id } = await ctx.params;
  const db = dbFor(me.orgId);
  const vendor = await db.vendor.findFirst({ where: { id }, select: { id: true, name: true, gstin: true } });
  if (!vendor) return notFound("Vendor");
  const invoices = await db.invoice.findMany({
    where: { vendorId: id, ...invoiceAccessWhere(me) },
    orderBy: { invoiceDate: "desc" },
    take: 50,
    select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, total: true, status: true, project: { select: { name: true } }, payments: { select: { amount: true } } },
  });
  let billed = 0;
  let paid = 0;
  const rows = invoices.map((i) => {
    const p = i.payments.reduce((sum, x) => sum + Number(x.amount), 0);
    // Invoices still being read or reviewed are not counted as owed yet.
    if (i.status !== "PROCESSING" && i.status !== "NEEDS_REVIEW") {
      billed += Number(i.total);
      paid += p;
    }
    return { id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, dueDate: i.dueDate, total: i.total, status: i.status, project: i.project };
  });
  return json({ vendor, totals: { billed: billed.toFixed(2), paid: paid.toFixed(2), owed: Math.max(0, billed - paid).toFixed(2) }, invoices: rows });
});
