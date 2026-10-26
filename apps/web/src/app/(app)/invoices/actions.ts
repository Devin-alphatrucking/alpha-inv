"use server";

import { hasPermission, seesAllProjects } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { assertInvoiceAccess } from "@/lib/invoices/access";
import { deleteInvoiceFiles } from "@/lib/azure/blob";
import { computeStatus } from "@/lib/invoices/status";
import { lockInvoice } from "@/lib/invoices/lock";
import { recordPayment } from "@/lib/invoices/payments";
import { companyTimeZone } from "@/lib/invoices/company-tz";

export async function recordInvoicePayment(input: {
  invoiceId: string;
  amount: number;
  paidOn: string;
  mode?: string;
  reference?: string;
  notes?: string;
}) {
  const user = await requirePermission("payment:create");
  const r = await recordPayment(user, input);

  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/invoices/${r.invoiceId}/review`);
  revalidatePath(`/projects/${r.projectId}`);

  return { paymentId: r.paymentId, status: r.status, paidAmount: r.paidAmount, balance: r.balance };
}

export async function deleteInvoicePayment(input: {
  invoiceId: string;
  paymentId: string;
}) {
  const user = await requirePermission("payment:delete");
  const db = scoped(user);

  const invoice = await assertInvoiceAccess(input.invoiceId, user);
  const payment = await db.payment.findFirst({
    where: { id: input.paymentId, invoiceId: invoice.id },
  });
  if (!payment) throw new AppError("NOT_FOUND_001", "Payment not found");

  const timeZone = await companyTimeZone(user.orgId);
  await db.$transaction(async (tx) => {
    await lockInvoice(tx, invoice.id);
    await tx.payment.delete({ where: { id: payment.id } });
    const live = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { total: true, dueDate: true } });
    const remainingPayments = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true }, _max: { paidOn: true } });
    const paid = Number(remainingPayments._sum.amount ?? 0);
    const status = computeStatus({ total: Number(live.total), paid, dueDate: live.dueDate, timeZone });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status, paidAt: status === "PAID" ? remainingPayments._max.paidOn : null },
    });
  });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "PAYMENT_DELETED",
    module: "PAYMENT",
    entityId: invoice.id,
    details: { paymentId: payment.id, amount: Number(payment.amount) },
  });

  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/invoices/${invoice.id}/review`);
  revalidatePath(`/projects/${invoice.projectId}`);
}

export async function deleteInvoice(invoiceId: string) {
  const user = await requirePermission("invoice:delete");
  const db = scoped(user);

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      uploadedById: true,
      projectId: true,
      fileUrl: true,
    },
  });

  if (!invoice) throw new AppError("NOT_FOUND_001", "Invoice not found");

  if (!seesAllProjects(user.role)) {
    const isUploader = invoice.uploadedById === user.id;
    const assignment = await db.projectAssignment.findFirst({
      where: { userId: user.id, projectId: invoice.projectId },
    });
    if (!isUploader && !assignment) {
      throw new AppError(
        "PERMISSION_001",
        "You do not have permission to delete this invoice"
      );
    }
  }

  // Deleting an invoice also deletes its payments. Removing a payment is an administrator action, so staff cannot get around that
  // by deleting an invoice that has money recorded against it.
  if (!hasPermission(user.role, "payment:delete")) {
    const recorded = await db.payment.count({ where: { invoiceId } });
    if (recorded > 0) {
      throw new AppError("PERMISSION_001", "This invoice has payments recorded. Ask an administrator to delete it.");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { invoiceId } });
    await tx.payment.deleteMany({ where: { invoiceId } });
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.delete({ where: { id: invoiceId } });
  });

  if (invoice.fileUrl) {
    try {
      await deleteInvoiceFiles([invoice.fileUrl]);
    } catch (err) {
      console.warn("Failed to delete invoice blob storage file:", err);
    }
  }

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "INVOICE_DELETED",
    module: "INVOICE",
    entityId: invoice.id,
    details: { invoiceNumber: invoice.invoiceNumber },
  });

  // Comprehensive cache invalidation so all counts and pages update immediately
  revalidatePath("/", "layout");
  revalidatePath("/invoices");
  revalidatePath("/invoices/upload");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/materials");
  revalidatePath("/projects");
  revalidatePath(`/projects/${invoice.projectId}`);
  revalidatePath("/vendors");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/activity");

  return { ok: true as const };
}
