"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@alpha/db";
import { scoped } from "@/lib/org/context";
import { assertProjectAccess } from "@/lib/projects/access";
import { AppError } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
  rateExclGst: z.coerce.number().nonnegative(),
  gstPercent: z.coerce.number().nonnegative().default(0),
  createMaterial: z.boolean().optional(),
});

const customTaxSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  amount: z.coerce.number(),
});

const confirmSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  vendorId: z.string().min(1).optional().nullable(),
  vendorName: z.string().min(1),
  vendorGstin: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  projectId: z.string().min(1),
  subtotal: z.coerce.number().nonnegative(),
  sgst: z.coerce.number().nonnegative(),
  cgst: z.coerce.number().nonnegative(),
  igst: z.coerce.number().nonnegative(),
  customTaxes: z.array(customTaxSchema).optional(),
  total: z.coerce.number().nonnegative(),
  lineItems: z.array(lineItemSchema).min(1),
});

export type ConfirmInvoiceInput = z.infer<typeof confirmSchema>;

function d(n: number) {
  return new Prisma.Decimal(n);
}

async function assertCanReview(invoiceId: string) {
  const session = await requirePermission("invoice:review");
  const db = scoped(session);

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: true,
      payments: { orderBy: { paidOn: "desc" } },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND_001", "Invoice not found");

  if (session.role === "STAFF") {
    const isUploader = invoice.uploadedById === session.id;
    const assignment = await db.projectAssignment.findFirst({
      where: { userId: session.id, projectId: invoice.projectId },
    });
    if (!isUploader && !assignment) {
      throw new AppError(
        "PERMISSION_001",
        "You do not have access to this invoice"
      );
    }
  }

  return { session, invoice };
}

export async function createCategoryInline(input: {
  name: string;
  unit?: string;
}) {
  const session = await requireUser();
  const db = scoped(session);

  const name = input.name.trim();
  if (!name) throw new AppError("VALIDATION_001", "Category name is required");

  const existing = await db.category.findFirst({ where: { name } });
  if (existing) return existing;

  const created = await db.category.create({
    data: {
      organizationId: session.orgId, name, unit: input.unit?.trim() || null },
  });

  await logActivity({
    userId: session.id,
    organizationId: session.orgId,
    action: "CATEGORY_CREATED",
    module: "CATEGORY",
    entityId: created.id,
    details: { name: created.name },
  });

  revalidatePath("/categories");
  revalidatePath("/invoices");
  return created;
}

export async function createVendorInline(input: {
  name: string;
  gstin?: string | null;
}) {
  const session = await requireUser();
  const db = scoped(session);

  const name = input.name.trim();
  if (!name) throw new AppError("VALIDATION_001", "Vendor name is required");
  const gstin = input.gstin?.trim() || null;

  if (gstin) {
    const byGstin = await db.vendor.findFirst({ where: { gstin } });
    if (byGstin) return byGstin;
  }

  const byName = await db.vendor.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (byName) return byName;

  const created = await db.vendor.create({ data: { name, gstin, organizationId: session.orgId } });

  await logActivity({
    userId: session.id,
    organizationId: session.orgId,
    action: "VENDOR_CREATED",
    module: "VENDOR",
    entityId: created.id,
    details: { name: created.name },
  });

  return created;
}

export async function checkDuplicateInvoice(
  vendorId: string,
  invoiceNumber: string,
  excludeId?: string
) {
  // Requires sign-in and only looks inside the user's company.
  const user = await requireUser();
  const db = scoped(user);
  const existing = await db.invoice.findFirst({
    where: {
      vendorId,
      invoiceNumber,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, invoiceNumber: true, status: true },
  });
  return existing;
}

export async function confirmInvoiceReview(raw: ConfirmInvoiceInput) {
  const parsed = confirmSchema.parse(raw);
  const { session, invoice } = await assertCanReview(parsed.invoiceId);
  const db = scoped(session);

  // Ids below come from the browser: prove they belong to this company
  // (and, for staff, that they may use the project).
  await assertProjectAccess(parsed.projectId, session);
  if (parsed.categoryId) {
    const category = await db.category.findUnique({
      where: { id: parsed.categoryId },
      select: { id: true },
    });
    if (!category) throw new AppError("VALIDATION_001", "Selected category was not found.");
  }

  const wasDraft =
    invoice.status === "NEEDS_REVIEW" || invoice.status === "PROCESSING";

  let vendorId = parsed.vendorId ?? null;
  const trimmedName = parsed.vendorName.trim();
  const trimmedGstin = parsed.vendorGstin?.trim() || null;

  if (trimmedGstin) {
    const existingByGstin = await db.vendor.findFirst({
      where: { gstin: trimmedGstin },
    });
    if (existingByGstin) {
      vendorId = existingByGstin.id;
      if (existingByGstin.name !== trimmedName && trimmedName) {
        await db.vendor.update({
          where: { id: existingByGstin.id },
          data: { name: trimmedName },
        });
      }
    } else if (vendorId) {
      await db.vendor.update({
        where: { id: vendorId },
        data: {
          name: trimmedName,
          gstin: trimmedGstin,
        },
      });
    } else {
      const vendor = await createVendorInline({
        name: trimmedName,
        gstin: trimmedGstin,
      });
      vendorId = vendor.id;
    }
  } else if (vendorId) {
    await db.vendor.update({
      where: { id: vendorId },
      data: {
        name: trimmedName,
        gstin: null,
      },
    });
  } else {
    const vendor = await createVendorInline({
      name: trimmedName,
      gstin: null,
    });
    vendorId = vendor.id;
  }

  const upperInvoiceNumber = parsed.invoiceNumber.trim().toUpperCase();
  const duplicate = await checkDuplicateInvoice(
    vendorId,
    upperInvoiceNumber,
    invoice.id
  );
  if (duplicate) {
    throw new AppError(
      "VALIDATION_001",
      `Invoice number "${upperInvoiceNumber}" already exists for this vendor. Duplicate invoice numbers are not allowed.`
    );
  }

  await db.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });

    const materialMap = new Map<string, string>();
    if (parsed.categoryId) {
      const existingMaterials = await tx.material.findMany({
        where: { categoryId: parsed.categoryId },
        select: { id: true, name: true },
      });
      for (const m of existingMaterials) {
        materialMap.set(m.name.toLowerCase().trim(), m.id);
      }

      for (const item of parsed.lineItems) {
        if (item.createMaterial && item.description.trim()) {
          const upperDesc = item.description.trim().toUpperCase();
          const key = upperDesc.toLowerCase();
          if (!materialMap.has(key)) {
            const created = await tx.material.create({
              data: {
                organizationId: session.orgId,
                categoryId: parsed.categoryId,
                name: upperDesc,
                defaultUnit: item.unit.trim().toUpperCase() || "NOS",
              },
              select: { id: true },
            });
            materialMap.set(key, created.id);
          }
        }
      }
    }

    const lineItemsData = parsed.lineItems.map((item) => {
      const upperDesc = item.description.trim().toUpperCase();
      const key = upperDesc.toLowerCase();
      const materialId =
        item.createMaterial && parsed.categoryId
          ? (materialMap.get(key) ?? null)
          : null;
      const gstAmount =
        Math.round(
          ((item.quantity * item.rateExclGst * item.gstPercent) / 100) * 100
        ) / 100;
      const lineTotal =
        Math.round((item.quantity * item.rateExclGst + gstAmount) * 100) / 100;

      return {
        organizationId: session.orgId,
        invoiceId: invoice.id,
        materialId,
        description: upperDesc,
        quantity: d(item.quantity),
        unit: item.unit.trim().toUpperCase(),
        rateExclGst: d(item.rateExclGst),
        gstPercent: d(item.gstPercent),
        gstAmount: d(gstAmount),
        lineTotal: d(lineTotal),
      };
    });

    await tx.invoiceLineItem.createMany({ data: lineItemsData });

    const paidAmount = invoice.payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0
    );
    const nextStatus = wasDraft
      ? "UNPAID"
      : paidAmount >= parsed.total - 0.01
        ? "PAID"
        : paidAmount > 0
          ? "PARTIALLY_PAID"
          : parsed.dueDate && new Date(parsed.dueDate) < new Date()
            ? "OVERDUE"
            : "UNPAID";

    const currentRaw = (invoice.extractionRaw as Prisma.JsonObject) || {};
    const updatedRaw = {
      ...currentRaw,
      customTaxes: parsed.customTaxes ?? [],
    };

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        invoiceNumber: upperInvoiceNumber,
        invoiceDate: new Date(parsed.invoiceDate),
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
        vendorId,
        categoryId: parsed.categoryId || null,
        projectId: parsed.projectId,
        subtotal: d(parsed.subtotal),
        sgst: d(parsed.sgst),
        cgst: d(parsed.cgst),
        igst: d(parsed.igst),
        total: d(parsed.total),
        extractionRaw: updatedRaw,
        status: nextStatus,
        paidAt:
          nextStatus === "PAID"
            ? invoice.paidAt ?? invoice.payments[0]?.paidOn ?? new Date()
            : null,
        reviewedById: session.id,
        reviewedAt: new Date(),
      },
    });
  });

  await logActivity({
    userId: session.id,
    organizationId: session.orgId,
    action: wasDraft ? "INVOICE_CREATED" : "INVOICE_UPDATED",
    module: "INVOICE",
    entityId: invoice.id,
    details: {
      invoiceNumber: parsed.invoiceNumber.trim(),
      total: parsed.total,
      status: wasDraft ? "UNPAID" : undefined,
    },
  });

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/invoices/${invoice.id}/review`);
  revalidatePath(`/projects/${parsed.projectId}`);
  return {
    ok: true as const,
    redirectUrl: wasDraft
      ? `/invoices?confirmed=${invoice.id}`
      : `/invoices?updated=${invoice.id}`,
  };
}
