import type { Prisma } from "@alpha/db";
import type { ScopedDb } from "@/lib/org/scoped-db";
import { summarise } from "./ageing";
import { todayIn } from "./status";

/** What needs a person's attention today: money overdue, money due soon, invoices waiting for review, and the ageing of everything owed. */
export async function loadAttention(db: ScopedDb, where: Prisma.InvoiceWhereInput, timeZone: string) {
  const [rows, drafts] = await Promise.all([
    db.invoice.findMany({
      where: { ...where, status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] } },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        dueDate: true,
        vendor: { select: { name: true } },
        project: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    }),
    db.invoice.count({ where: { ...where, status: { in: ["NEEDS_REVIEW", "PROCESSING"] } } }),
  ]);
  const summary = summarise(
    rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      vendorName: r.vendor.name,
      projectName: r.project.name,
      total: Number(r.total),
      paid: r.payments.reduce((s, p) => s + Number(p.amount), 0),
      dueDate: r.dueDate,
    })),
    todayIn(timeZone),
  );
  return { summary, drafts };
}
