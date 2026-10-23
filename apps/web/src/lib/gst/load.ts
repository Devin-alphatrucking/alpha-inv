import type { ScopedDb } from "@/lib/org/scoped-db";
import type { GstInvoice } from "./report";

/** Confirmed invoices dated inside the period (inclusive), as plain numbers. Drafts waiting for review are not part of any tax report. */
export async function loadGstInvoices(db: ScopedDb, period: { from: string; to: string }, projectId?: string | null): Promise<GstInvoice[]> {
  const rows = await db.invoice.findMany({
    where: {
      status: { notIn: ["NEEDS_REVIEW", "PROCESSING"] },
      invoiceDate: { gte: new Date(`${period.from}T00:00:00.000Z`), lte: new Date(`${period.to}T00:00:00.000Z`) },
      ...(projectId ? { projectId } : {}),
    },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, subtotal: true, cgst: true, sgst: true, igst: true, rounding: true, total: true, status: true,
      vendor: { select: { id: true, name: true, gstin: true } },
      project: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    vendorId: r.vendor.id,
    vendorName: r.vendor.name,
    vendorGstin: r.vendor.gstin,
    projectName: r.project.name,
    subtotal: Number(r.subtotal),
    cgst: Number(r.cgst),
    sgst: Number(r.sgst),
    igst: Number(r.igst),
    rounding: Number(r.rounding),
    total: Number(r.total),
    status: r.status,
  }));
}
