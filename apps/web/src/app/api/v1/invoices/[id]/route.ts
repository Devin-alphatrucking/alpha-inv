import { AppError } from "@/lib/errors";
import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { syncOverdue } from "@/lib/invoices/overdue";
import { isPayableStatus } from "@/lib/invoices/access";
import { hasPermission } from "@/lib/roles";

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
      payments: { select: { id: true, amount: true, paidOn: true, mode: true, reference: true, notes: true }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] },
      lineItems: { select: { id: true, description: true, hsnCode: true, quantity: true, unit: true, rateExclGst: true, gstPercent: true, gstAmount: true, lineTotal: true } },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND_001", "Invoice not found.");
  // The original file is fetched with the same bearer token from the existing endpoint.
  const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, Number(invoice.total) - paid);
  return json({
    invoice,
    paid: paid.toFixed(2),
    balance: balance.toFixed(2),
    // Whether this person may record a payment now (the server checks again when they try).
    canPay: hasPermission(me.role, "payment:create") && isPayableStatus(invoice.status) && balance > 0,
    fileUrl: `/api/invoices/${invoice.id}/file`,
  });
});
