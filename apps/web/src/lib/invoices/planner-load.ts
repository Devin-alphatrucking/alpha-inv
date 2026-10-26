import type { Prisma } from "@alpha/db";
import type { ScopedDb } from "@/lib/org/scoped-db";
import { owedList } from "./planner";

/** Everything still owed on confirmed invoices (optionally one project), soonest-due first. Amounts in the rows are plain numbers. */
export async function loadOwed(db: ScopedDb, where: Prisma.InvoiceWhereInput, today: string) {
  const rows = await db.invoice.findMany({
    where: { ...where, status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] } },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      dueDate: true,
      vendor: { select: { name: true, gstin: true } },
      project: { select: { name: true } },
      payments: { select: { amount: true } },
    },
  });
  return owedList(
    rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      vendorName: r.vendor.name,
      projectName: r.project.name,
      total: Number(r.total),
      paid: r.payments.reduce((s, p) => s + Number(p.amount), 0),
      dueDate: r.dueDate,
    })),
    today,
  );
}
