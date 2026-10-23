import type { Prisma } from "@alpha/db";
import type { ScopedDb } from "@/lib/org/scoped-db";
import { baselinesFrom, lineKey, type RateBaseline } from "./rate-alerts";

/**
 * What this company usually pays for each of these items: built from the line items of its CONFIRMED invoices (never the
 * invoice being reviewed, never drafts), matched by description and unit.
 * `access` limits which invoices count: staff are judged only against invoices they can already see (their own uploads and
 * assigned projects), so a warning never reveals another project's prices. Administrators pass nothing and get the whole company.
 */
export async function loadRateBaselines(
  db: ScopedDb,
  invoiceId: string,
  lines: { description: string; unit: string }[],
  access: Prisma.InvoiceWhereInput = {},
): Promise<Map<string, RateBaseline>> {
  const wanted = new Map<string, { description: string; unit: string }>();
  for (const l of lines) {
    const description = l.description.trim();
    if (description) wanted.set(lineKey(description, l.unit), { description, unit: l.unit.trim() });
  }
  if (wanted.size === 0) return new Map();
  const items = [...wanted.values()].slice(0, 60);

  const rows = await db.invoiceLineItem.findMany({
    where: {
      OR: items.map((i) => ({ description: { equals: i.description, mode: "insensitive" as const }, unit: { equals: i.unit, mode: "insensitive" as const } })),
      invoice: { is: { id: { not: invoiceId }, status: { notIn: ["NEEDS_REVIEW", "PROCESSING"] }, ...access } },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: 2000,
    select: { description: true, unit: true, rateExclGst: true, invoice: { select: { invoiceDate: true, vendor: { select: { name: true } } } } },
  });

  return baselinesFrom(
    rows.map((r) => ({ description: r.description, unit: r.unit, rate: Number(r.rateExclGst), invoiceDate: r.invoice.invoiceDate, vendorName: r.invoice.vendor.name })),
  );
}
