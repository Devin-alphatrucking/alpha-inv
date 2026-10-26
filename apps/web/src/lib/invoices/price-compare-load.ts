import type { ScopedDb } from "@/lib/org/scoped-db";
import type { PurchaseLine } from "./price-compare";

/** What was bought since a date (YYYY-MM-DD, inclusive) on CONFIRMED invoices, one row per line item, optionally for one project. */
export async function loadPurchaseLines(db: ScopedDb, opts: { since: string; projectId?: string | null }): Promise<{ lines: PurchaseLine[]; capped: boolean }> {
  const CAP = 20000;
  const rows = await db.invoiceLineItem.findMany({
    where: {
      invoice: {
        is: {
          status: { notIn: ["NEEDS_REVIEW", "PROCESSING"] },
          invoiceDate: { gte: new Date(`${opts.since}T00:00:00.000Z`) },
          ...(opts.projectId ? { projectId: opts.projectId } : {}),
        },
      },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: CAP + 1,
    select: { description: true, unit: true, rateExclGst: true, quantity: true, invoice: { select: { invoiceDate: true, vendorId: true, vendor: { select: { name: true } } } } },
  });
  return {
    capped: rows.length > CAP,
    lines: rows.slice(0, CAP).map((r) => ({
      description: r.description,
      unit: r.unit,
      rate: Number(r.rateExclGst),
      quantity: Number(r.quantity),
      vendorId: r.invoice.vendorId,
      vendorName: r.invoice.vendor.name,
      invoiceDate: r.invoice.invoiceDate,
    })),
  };
}
