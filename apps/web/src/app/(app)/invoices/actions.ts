"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import {
  assertInvoiceAccess,
  isPayableStatus,
} from "@/lib/invoices/access";
import { deleteInvoiceFiles } from "@/lib/azure/blob";
import { getFormat } from "@/lib/brand/brand";

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidOn: z.string().min(1),
  mode: z.string().trim().max(50).optional(),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordInvoicePayment(input: {
  invoiceId: string;
  amount: number;
  paidOn: string;
  mode?: string;
  reference?: string;
  notes?: string;
}) {
  const user = await requirePermission("payment:create");
  const db = scoped(user);

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_001",
      "Payment details are invalid."
    );
  }

  const invoice = await assertInvoiceAccess(parsed.data.invoiceId, user);

  if (!isPayableStatus(invoice.status)) {
    throw new AppError(
      "PAYMENT_001",
      "Only confirmed invoices can be marked paid or unpaid. Finish review first."
    );
  }

  const paidOn = new Date(parsed.data.paidOn);
  if (Number.isNaN(paidOn.getTime())) {
    throw new AppError("VALIDATION_001", "Invalid payment date");
  }

  const aggregate = await db.payment.aggregate({
    where: { invoiceId: invoice.id },
    _sum: { amount: true },
  });
  const alreadyPaid = Number(aggregate._sum.amount ?? 0);
  const invoiceTotal = Number(invoice.total);
  const remaining = Math.max(0, invoiceTotal - alreadyPaid);
  if (parsed.data.amount > remaining + 0.01) {
    throw new AppError(
      "PAYMENT_001",
      `Payment cannot exceed the remaining balance of ${(await getFormat()).money(remaining, 2)}`
    );
  }

  const newPaidTotal = alreadyPaid + parsed.data.amount;
  const fullyPaid = newPaidTotal >= invoiceTotal - 0.01;

  const payment = await db.$transaction(async (tx) => {
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
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
        paidAt: fullyPaid ? paidOn : null,
      },
    });
    return created;
  });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "PAYMENT_CREATED",
    module: "PAYMENT",
    entityId: invoice.id,
    details: {
      paymentId: payment.id,
      amount: parsed.data.amount,
      fullyPaid,
    },
  });

  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/invoices/${invoice.id}/review`);
  revalidatePath(`/projects/${invoice.projectId}`);

  return {
    paymentId: payment.id,
    status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
    paidAmount: newPaidTotal,
    balance: Math.max(0, invoiceTotal - newPaidTotal),
  };
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

  await db.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id: payment.id } });
    const remainingPayments = await tx.payment.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amount: true },
    });
    const paid = Number(remainingPayments._sum.amount ?? 0);
    const total = Number(invoice.total);
    const status =
      paid >= total - 0.01
        ? "PAID"
        : paid > 0
          ? "PARTIALLY_PAID"
          : invoice.dueDate && invoice.dueDate < new Date()
            ? "OVERDUE"
            : "UNPAID";
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status, paidAt: status === "PAID" ? invoice.paidAt : null },
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

  if (user.role !== "ADMIN") {
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
