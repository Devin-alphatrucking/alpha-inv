import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { assertInvoiceAccess, isPayableStatus } from "@/lib/invoices/access";
import { loadBrandById } from "@/lib/brand/brand";
import { makeFormatters, DEFAULT_FORMAT } from "@/lib/brand/format";
import { computeStatus, remainingMinor, toMinor } from "./status";
import { lockInvoice } from "./lock";
import { companyTimeZone } from "./company-tz";

/** Recording a payment, as one function the server action and the tests both call. */

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidOn: z.string().min(1),
  mode: z.string().trim().max(50).optional(),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type PaymentUser = { id: string; orgId: string; role: "ADMIN" | "STAFF" };

export async function recordPayment(
  user: PaymentUser,
  input: { invoiceId: string; amount: number; paidOn: string; mode?: string; reference?: string; notes?: string },
) {
  const db = scoped(user);

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_001", "Payment details are invalid.");

  const invoice = await assertInvoiceAccess(parsed.data.invoiceId, user);
  if (!isPayableStatus(invoice.status)) {
    throw new AppError("PAYMENT_001", "Only confirmed invoices can be marked paid or unpaid. Finish review first.");
  }

  const paidOn = new Date(parsed.data.paidOn);
  if (Number.isNaN(paidOn.getTime())) throw new AppError("VALIDATION_001", "Invalid payment date");

  const timeZone = await companyTimeZone(user.orgId);
  const brand = await loadBrandById(user.orgId);
  const money = makeFormatters(brand?.format ?? DEFAULT_FORMAT).money;

  // Everything that depends on what was paid so far happens under a lock on this invoice, so two payments saved at the same
  // moment cannot both pass the balance check, and the status is always worked out from the real total.
  const result = await db.$transaction(async (tx) => {
    await lockInvoice(tx, invoice.id);
    const live = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { total: true, dueDate: true, status: true } });
    if (!isPayableStatus(live.status)) {
      throw new AppError("PAYMENT_001", "Only confirmed invoices can be marked paid or unpaid. Finish review first.");
    }
    const aggregate = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
    const alreadyPaid = Number(aggregate._sum.amount ?? 0);
    const invoiceTotal = Number(live.total);
    const remaining = remainingMinor(invoiceTotal, alreadyPaid);
    if (toMinor(parsed.data.amount) > remaining) {
      throw new AppError("PAYMENT_001", `Payment cannot exceed the remaining balance of ${money(remaining / 100, 2)}`);
    }

    const created = await tx.payment.create({
      data: {
        organizationId: user.orgId,
        invoiceId: invoice.id,
        amount: parsed.data.amount,
        paidOn,
        mode: parsed.data.mode || null,
        reference: parsed.data.reference || null,
        notes: parsed.data.notes || null,
        paidById: user.id,
      },
    });
    const newPaidTotal = alreadyPaid + parsed.data.amount;
    const status = computeStatus({ total: invoiceTotal, paid: newPaidTotal, dueDate: live.dueDate, timeZone });
    const latest = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _max: { paidOn: true } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status, paidAt: status === "PAID" ? (latest._max.paidOn ?? paidOn) : null },
    });
    return { created, status, newPaidTotal, invoiceTotal };
  });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "PAYMENT_CREATED",
    module: "PAYMENT",
    entityId: invoice.id,
    details: { paymentId: result.created.id, amount: parsed.data.amount, fullyPaid: result.status === "PAID" },
  });

  return {
    invoiceId: invoice.id,
    projectId: invoice.projectId,
    paymentId: result.created.id,
    status: result.status,
    paidAmount: result.newPaidTotal,
    balance: Math.max(0, result.invoiceTotal - result.newPaidTotal),
  };
}
