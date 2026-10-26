import type { RoleName } from "@/lib/roles";
import { Prisma } from "@alpha/db";
import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import {
  extractInvoice,
  type ExtractedInvoice,
} from "@/lib/azure/document-intelligence";
import { deleteInvoiceFiles, uploadInvoiceFile } from "@/lib/azure/blob";
import { getProjectAzureCredentials } from "@/lib/azure/project-credentials";
import { AppError } from "@/lib/errors";
import { assertProjectAccess } from "@/lib/projects/access";
import { assertCanUpload } from "@/lib/plans/entitlements";
import { countBillablePages, hashFile } from "@/lib/invoices/page-count";
import {
  attachInvoiceToEvent,
  refundPages,
  reservePages,
  settlePages,
} from "@/lib/usage/pages";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

function halfTax(totalTax: number | undefined) {
  if (totalTax == null || Number.isNaN(totalTax)) {
    return { sgst: 0, cgst: 0, igst: 0 };
  }
  // Assume intra-state CGST+SGST split when only TotalTax is present.
  const half = Math.round((totalTax / 2) * 100) / 100;
  return { sgst: half, cgst: half, igst: 0 };
}

/**
 * The supplier on an invoice: matched by GSTIN, then by name, else created. Done one at a time per company (a short
 * lock), because a batch upload reads several invoices at once and two from a NEW supplier would otherwise each create it
 * (a GSTIN clash, or two vendors with the same name when there is no GSTIN).
 */
export async function resolveVendor(orgId: string, extracted: Pick<ExtractedInvoice, "vendorGstin" | "vendorName">) {
  const gstin = extracted.vendorGstin?.trim().toUpperCase() || undefined;
  const name = (extracted.vendorName?.trim() || "UNKNOWN VENDOR").toUpperCase();

  return rawDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"vendor:" + orgId}))`;

    if (gstin) {
      const byGstin = await tx.vendor.findFirst({ where: { organizationId: orgId, gstin } });
      if (byGstin) return byGstin;
    }
    const byName = await tx.vendor.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } } });
    if (byName) return byName;
    return tx.vendor.create({ data: { name, gstin: gstin ?? null, organizationId: orgId } });
  });
}

function decimal(value: number | undefined | null, fallback = 0) {
  const n =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return new Prisma.Decimal(n);
}

/**
 * Persist uploaded file, run Document Intelligence, and create a draft
 * invoice in NEEDS_REVIEW with extracted line items.
 */
export async function processInvoiceUpload(params: {
  file: File;
  /** Company of the signed-in user. Everything below is locked to it. */
  orgId: string;
  userId: string;
  role: RoleName;
  projectId: string;
  categoryId?: string | null;
}) {
  const { file, orgId, userId, role, projectId, categoryId } = params;
  const db = dbFor(orgId);

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new AppError("VALIDATION_001", "Only PDF, JPG, or PNG files are supported.");
  }
  if (file.size > MAX_BYTES) {
    throw new AppError("VALIDATION_001", "File must be 20MB or smaller.");
  }

  const resolvedCategoryId: string | null = categoryId?.trim() || null;
  if (resolvedCategoryId) {
    const category = await db.category.findUnique({
      where: { id: resolvedCategoryId },
    });
    if (!category) {
      throw new AppError("VALIDATION_001", "Selected category was not found. Pick another category.");
    }
  } else {
    throw new AppError("VALIDATION_001", "Please select a category before extracting.");
  }

  // Cheap checks first: access, then identical-file, then page quota. Nothing
  // below calls Azure until pages are reserved.
  await assertProjectAccess(projectId, { id: userId, role, orgId });
  // No new AI work unless the company's plan is in good standing (trial, paid or inside the grace period).
  await assertCanUpload(orgId);

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = hashFile(buffer);

  const sameFile = await db.invoice.findFirst({
    where: { projectId, fileHash },
    select: { id: true, invoiceNumber: true },
  });
  if (sameFile) {
    throw new AppError(
      "VALIDATION_001",
      `This exact file was already uploaded as invoice ${sameFile.invoiceNumber}. No AI pages were used.`
    );
  }

  const credentials = await getProjectAzureCredentials(projectId, orgId);
  const pages = await countBillablePages(buffer, file.type);

  // Counted here, before the AI runs. Deleting the invoice later never
  // gives these pages back.
  const reservation = await reservePages({
    orgId,
    projectId,
    userId,
    pages,
    fileHash,
  });

  let fileUrl: string;
  try {
    fileUrl = await uploadInvoiceFile(file.name, buffer, file.type);
  } catch (error) {
    await refundPages(orgId, reservation.eventId, "STORAGE_FAILED");
    throw error;
  }

  let extracted: ExtractedInvoice;
  try {
    extracted = await extractInvoice(buffer, credentials);
  } catch (error) {
    // Our/Azure-side failure: give the pages back and drop the orphan file.
    await refundPages(orgId, reservation.eventId, "OCR_FAILED");
    await deleteInvoiceFiles([fileUrl]).catch(() => undefined);
    // Shown to the person (a plain Error would only say "Internal server error"). The pages were given back above.
    throw new AppError(
      "INVOICE_001",
      `The AI could not read this file${error instanceof Error && error.message ? ` (${error.message.slice(0, 160)})` : ""}. No AI pages were used.`
    );
  }

  // Correct the counters to what Azure really analysed.
  const actualPages = extracted.pageCount > 0 ? extracted.pageCount : pages;
  await settlePages(orgId, reservation.eventId, actualPages);

  // From here on a failure (duplicate number, two uploads racing for the same vendor, a database error) must not leave the stored file behind.
  // The AI pages stay counted: Azure already did the work.
  const invoice = await (async () => {
    const vendor = await resolveVendor(orgId, extracted);

    const invoiceNumber = (
      extracted.invoiceNumber?.trim() || `DRAFT-${Date.now()}`
    ).toUpperCase();
    const invoiceDate = extracted.invoiceDate
      ? new Date(extracted.invoiceDate)
      : new Date();
    const dueDate = extracted.dueDate ? new Date(extracted.dueDate) : null;
    const taxes = halfTax(extracted.totalTax);
    const total =
      extracted.invoiceTotal ??
      (extracted.subtotal ?? 0) + (extracted.totalTax ?? 0);

    // Check for duplicate invoice on upload
    // If invoice already exists for this vendor, throw an error and reject the upload!
    const isAutoDraft = invoiceNumber.startsWith("DRAFT-");
    if (!isAutoDraft) {
      const existing = await db.invoice.findFirst({
        where: {
          vendorId: vendor.id,
          invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
        },
        select: { id: true, invoiceNumber: true },
      });
      if (existing) {
        throw new AppError(
          "VALIDATION_001",
          `Invoice #${invoiceNumber} already exists for vendor "${vendor.name}". Duplicate invoice cannot be uploaded. (${actualPages} AI page(s) were used reading it.)`
        );
      }
    }

    // Strip non-serializable bits; keep a small normalized summary for the review UI
    const rawJson = JSON.parse(
      JSON.stringify(
        {
          ...extracted.raw,
          _normalized: {
            vendorName: vendor.name,
            vendorGstin: vendor.gstin,
            invoiceNumber,
            lineItemConfidences: extracted.lineItems.map((i) => i.confidence),
          },
        },
        (_key, value) => (value instanceof Date ? value.toISOString() : value)
      )
    ) as Prisma.InputJsonValue;

    return db.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          organizationId: orgId,
          invoiceNumber,
          projectId,
          vendorId: vendor.id,
          categoryId: resolvedCategoryId,
          invoiceDate,
          dueDate,
          subtotal: decimal(extracted.subtotal),
          sgst: decimal(taxes.sgst),
          cgst: decimal(taxes.cgst),
          igst: decimal(taxes.igst),
          total: decimal(total),
          status: "NEEDS_REVIEW",
          fileUrl,
          fileHash,
          pageCount: actualPages,
          extractionRaw: rawJson,
          uploadedById: userId,
          lineItems: {
            create: extracted.lineItems.map((item) => {
              const qty = item.quantity ?? 1;
              const rate = item.unitPrice ?? 0;
              const amount = item.amount ?? qty * rate;
              return {
                // nested rows are not stamped by the scoped client
                organizationId: orgId,
                description: (item.description || "LINE ITEM").trim().toUpperCase(),
                quantity: decimal(qty, 1),
                unit: (item.unit || "NOS").trim().toUpperCase(),
                rateExclGst: decimal(rate),
                gstPercent: decimal(0),
                gstAmount: decimal(0),
                lineTotal: decimal(amount),
              };
            }),
          },
        },
        include: { lineItems: true, vendor: true },
      });
      return created;
    });
  })().catch(async (error: unknown) => {
    await deleteInvoiceFiles([fileUrl]).catch(() => undefined);
    if ((error as { code?: string })?.code === "P2002") {
      throw new AppError("VALIDATION_001", "This invoice (same vendor and invoice number) was added a moment ago by another upload. Open it from the invoices list.");
    }
    throw error;
  });

  await attachInvoiceToEvent(orgId, reservation.eventId, invoice.id).catch(() => undefined);

  return {
    invoiceId: invoice.id,
    duplicateWarning: false,
    originalInvoiceNumber: null,
  };
}
