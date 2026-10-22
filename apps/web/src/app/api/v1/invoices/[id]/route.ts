import { AppError } from "@/lib/errors";
import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { syncOverdue } from "@/lib/invoices/overdue";

export const runtime = "nodejs";

export const GET = route<{ params: Promise<{ id: string }> }>("/api/v1/invoices/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  const { id } = await ctx.params;
  await syncOverdue(me.orgId);
  const invoice = await dbFor(me.orgId).invoice.findFirst({
    where: { id, ...invoiceAccessWhere(me) },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      deliveryDate: true,
      subtotal: true,
      sgst: true,
      cgst: true,
      igst: true,
      rounding: true,
      total: true,
      paymentTerms: true,
      status: true,
      paidAt: true,
      pageCount: true,
      createdAt: true,
      vendor: { select: { id: true, name: true, gstin: true } },
      project: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      lineItems: { select: { id: true, description: true, hsnCode: true, quantity: true, unit: true, rateExclGst: true, gstPercent: true, gstAmount: true, lineTotal: true } },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND_001", "Invoice not found.");
  // The original file is fetched with the same bearer token from the existing endpoint.
  return json({ invoice, fileUrl: `/api/invoices/${invoice.id}/file` });
});
