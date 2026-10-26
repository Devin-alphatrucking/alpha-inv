"use server";

import { seesAllProjects } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@alpha/db";
import { scoped } from "@/lib/org/context";
import { assertProjectAccess } from "@/lib/projects/access";
import { AppError } from "@/lib/errors";
import { hasPermission, requirePermission, requireUser } from "@/lib/permissions";
import { computeStatus, round2 } from "@/lib/invoices/status";
import { lockInvoice } from "@/lib/invoices/lock";
import { lineKey, storedDeviation } from "@/lib/invoices/rate-alerts";
import { loadRateBaselines } from "@/lib/invoices/rate-baseline";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { logActivity } from "@/lib/activity";

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  // Credit notes and discount lines have negative amounts, so only "a real number" is required.
  quantity: z.coerce.number().refine(Number.isFinite, "Quantity must be a number"),
  unit: z.string().min(1),
  rateExclGst: z.coerce.number().refine(Number.isFinite, "Rate must be a number"),
  gstPercent: z.coerce.number().min(0).max(100).default(0),
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
  // An invoice read by the AI can have no item lines at all; it can still be confirmed on its totals.
  lineItems: z.array(lineItemSchema).max(500),
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

  if (!seesAllProjects(session.role)) {
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
  // Renaming a vendor or changing its GSTIN changes every invoice of that vendor in the company, so only people who may manage vendors can.
  // Everyone else can pick an existing vendor or add a new one.
  const canManageVendors = hasPermission(session.role, "vendor:manage");

  if (vendorId) {
    const known = await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!known) throw new AppError("VALIDATION_001", "Selected vendor was not found.");
  }

  if (trimmedGstin) {
    const existingByGstin = await db.vendor.findFirst({ where: { gstin: trimmedGstin } });
    if (existingByGstin) {
      vendorId = existingByGstin.id;
      if (canManageVendors && existingByGstin.name !== trimmedName && trimmedName) {
        await db.vendor.update({ where: { id: existingByGstin.id }, data: { name: trimmedName } });
      }
    } else if (vendorId) {
      if (canManageVendors) {
        await db.vendor.update({ where: { id: vendorId }, data: { name: trimmedName, gstin: trimmedGstin } });
      }
    } else {
      const vendor = await createVendorInline({ name: trimmedName, gstin: trimmedGstin });
      vendorId = vendor.id;
    }
  } else if (vendorId) {
    if (canManageVendors) {
      await db.vendor.update({ where: { id: vendorId }, data: { name: trimmedName, gstin: null } });
    }
  } else {
    const vendor = await createVendorInline({ name: trimmedName, gstin: null });
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

  const timeZone = await companyTimeZone(session.orgId);
  // How far each rate is from what the company usually pays (the whole company's history, whoever confirms), saved with the line.
  const baselines = await loadRateBaselines(db, invoice.id, parsed.lineItems);

  await db.$transaction(async (tx) => {
    // One confirmation at a time per invoice: a second tab or a retry waits here instead of doubling the line items.
    await lockInvoice(tx, invoice.id);
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, paidAt: true, extractionRaw: true } });
    const livePayments = await tx.payment.findMany({ where: { invoiceId: invoice.id }, select: { amount: true, paidOn: true } });
    const isDraftNow = current.status === "NEEDS_REVIEW" || current.status === "PROCESSING";

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
      const gstAmount = round2((item.quantity * item.rateExclGst * item.gstPercent) / 100);
      const lineTotal = round2(item.quantity * item.rateExclGst + gstAmount);

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
        rateDeviationPercent: (() => {
          const pct = storedDeviation(item.rateExclGst, baselines.get(lineKey(upperDesc, item.unit)));
          return pct === null ? null : d(pct);
        })(),
      };
    });

    await tx.invoiceLineItem.createMany({ data: lineItemsData });

    const paidAmount = livePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    // Same rule everywhere (payments, overdue sweep, mobile): see lib/invoices/status.ts. A draft starts unpaid, or overdue if its due date has already passed.
    const nextStatus = computeStatus({ total: parsed.total, paid: isDraftNow ? 0 : paidAmount, dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null, timeZone });
    const latestPaidOn = livePayments.reduce<Date | null>((m, p) => (!m || p.paidOn > m ? p.paidOn : m), null);

    const currentRaw = (current.extractionRaw as Prisma.JsonObject) || {};
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
        paidAt: nextStatus === "PAID" ? (latestPaidOn ?? current.paidAt ?? new Date()) : null,
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
