import type { Prisma } from "@alpha/db";
import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { syncOverdue } from "@/lib/invoices/overdue";

export const runtime = "nodejs";

const STATUSES = ["PROCESSING", "NEEDS_REVIEW", "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;

/** Invoices the person may see. Filters: q (invoice number or vendor), status, projectId; paging: page, pageSize (max 50). */
export const GET = route("/api/v1/invoices", async (req) => {
  const me = await requireMobile(req);
  await syncOverdue(me.orgId);
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(sp.get("pageSize")) || 20));
  const q = sp.get("q")?.trim().slice(0, 80);
  const status = sp.get("status");
  const projectId = sp.get("projectId");

  const and: Prisma.InvoiceWhereInput[] = [invoiceAccessWhere(me)];
  if (status && (STATUSES as readonly string[]).includes(status)) and.push({ status: status as (typeof STATUSES)[number] });
  if (projectId) and.push({ projectId });
  if (q) and.push({ OR: [{ invoiceNumber: { contains: q, mode: "insensitive" } }, { vendor: { name: { contains: q, mode: "insensitive" } } }] });
  const where: Prisma.InvoiceWhereInput = { AND: and };

  const db = dbFor(me.orgId);
  const [total, items] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        status: true,
        paidAt: true,
        createdAt: true,
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
  ]);
  return json({ page, pageSize, total, items });
});
