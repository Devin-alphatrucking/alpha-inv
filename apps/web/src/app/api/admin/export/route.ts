import ExcelJS from "exceljs";
import { rawDb } from "@/lib/db";
import { scoped } from "@/lib/org/context";
import { requireAdmin } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

const DATASETS = [
  "projects",
  "invoices",
  "invoice-items",
  "payments",
  "vendors",
  "categories",
  "materials",
  "users",
  "assignments",
  "project-notes",
  "audit-logs",
  "activity-logs",
  "error-logs",
] as const;

type Dataset = (typeof DATASETS)[number];
type CellValue = string | number | boolean | Date | null;
type ExportRow = Record<string, CellValue>;

function jsonValue(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function decimalValue(value: unknown) {
  return value == null ? null : Number(value);
}

async function loadData(orgId: string, db: ReturnType<typeof scoped>): Promise<Record<Dataset, ExportRow[]>> {
  const [projects, invoices, payments, vendors, categories, materials, users, assignments, notes, auditLogs, activityLogs, errorLogs] = await Promise.all([
    db.project.findMany({ orderBy: { createdAt: "asc" } }),
    db.invoice.findMany({
      include: { project: true, vendor: true, category: true, uploadedBy: true, reviewedBy: true, lineItems: true },
      orderBy: { createdAt: "asc" },
    }),
    db.payment.findMany({ include: { invoice: true, paidBy: true }, orderBy: { createdAt: "asc" } }),
    db.vendor.findMany({ orderBy: { createdAt: "asc" } }),
    db.category.findMany({ orderBy: { createdAt: "asc" } }),
    db.material.findMany({ include: { category: true }, orderBy: { createdAt: "asc" } }),
    // The role in THIS company (membership), never the legacy global role; no password hash, ever.
    rawDb.membership.findMany({ where: { organizationId: orgId }, select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, updatedAt: true } } }, orderBy: { createdAt: "asc" } }),
    db.projectAssignment.findMany({ include: { user: true, project: true }, orderBy: { createdAt: "asc" } }),
    db.projectNote.findMany({ include: { user: true, project: true }, orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({ include: { user: true, invoice: true }, orderBy: { createdAt: "asc" } }),
    db.activityLog.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.apiErrorLog.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  return {
    // Explicit columns only: a new column (such as a secret) must never reach an export by accident. The encrypted Azure key stays out.
    projects: projects.map((row) => ({
      id: row.id, name: row.name, description: row.description, address: row.address, status: row.status,
      monthlyPageLimit: row.monthlyPageLimit, azureConfigured: Boolean(row.azureKeyEnc), createdAt: row.createdAt, updatedAt: row.updatedAt,
    })),
    invoices: invoices.map((row) => ({
      id: row.id, invoiceNumber: row.invoiceNumber, project: row.project.name,
      vendor: row.vendor.name, category: row.category?.name ?? null,
      invoiceDate: row.invoiceDate, dueDate: row.dueDate, deliveryDate: row.deliveryDate,
      subtotal: decimalValue(row.subtotal), sgst: decimalValue(row.sgst), cgst: decimalValue(row.cgst),
      igst: decimalValue(row.igst), rounding: decimalValue(row.rounding), total: decimalValue(row.total),
      paymentTerms: row.paymentTerms, status: row.status, paidAt: row.paidAt, fileUrl: row.fileUrl,
      uploadedBy: row.uploadedBy?.email ?? null, reviewedBy: row.reviewedBy?.email ?? null,
      reviewedAt: row.reviewedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
      extractionRaw: jsonValue(row.extractionRaw),
    })),
    "invoice-items": invoices.flatMap((invoice) => invoice.lineItems.map((row) => ({
      id: row.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      description: row.description, hsnCode: row.hsnCode, quantity: decimalValue(row.quantity),
      unit: row.unit, rateExclGst: decimalValue(row.rateExclGst), gstPercent: decimalValue(row.gstPercent),
      gstAmount: decimalValue(row.gstAmount), lineTotal: decimalValue(row.lineTotal),
      rateDeviationPercent: decimalValue(row.rateDeviationPercent),
    }))),
    payments: payments.map((row) => ({
      id: row.id, invoiceId: row.invoiceId, invoiceNumber: row.invoice.invoiceNumber,
      amount: decimalValue(row.amount), paidOn: row.paidOn, mode: row.mode, reference: row.reference,
      notes: row.notes, paidBy: row.paidBy?.email ?? null, createdAt: row.createdAt,
    })),
    vendors: vendors.map((row) => ({ id: row.id, name: row.name, gstin: row.gstin, address: row.address, contact: row.contact, createdAt: row.createdAt })),
    categories: categories.map((row) => ({ id: row.id, name: row.name, unit: row.unit, createdAt: row.createdAt })),
    materials: materials.map((row) => ({
      id: row.id, category: row.category.name, name: row.name, hsnCode: row.hsnCode,
      defaultUnit: row.defaultUnit, createdAt: row.createdAt,
    })),
    users: users.map((row) => ({ id: row.user.id, name: row.user.name, email: row.user.email, role: row.role, joinedAt: row.createdAt, updatedAt: row.user.updatedAt })),
    assignments: assignments.map((row) => ({
      id: row.id, userId: row.userId, userName: row.user.name, userEmail: row.user.email,
      projectId: row.projectId, project: row.project.name, createdAt: row.createdAt,
    })),
    "project-notes": notes.map((row) => ({
      id: row.id, projectId: row.projectId, project: row.project.name,
      userId: row.userId, user: row.user.email, content: row.content, createdAt: row.createdAt,
    })),
    "audit-logs": auditLogs.map((row) => ({
      id: row.id, invoiceId: row.invoiceId, invoiceNumber: row.invoice.invoiceNumber,
      user: row.user?.email ?? null, field: row.field, oldValue: row.oldValue,
      newValue: row.newValue, createdAt: row.createdAt,
    })),
    "activity-logs": activityLogs.map((row) => ({
      id: row.id, user: row.user?.email ?? null, action: row.action, module: row.module,
      entityId: row.entityId, details: jsonValue(row.details), ipAddress: row.ipAddress,
      userAgent: row.userAgent, createdAt: row.createdAt,
    })),
    "error-logs": errorLogs.map((row) => ({
      id: row.id, statusCode: row.statusCode, errorCode: row.errorCode, endpoint: row.endpoint, method: row.method,
      userId: row.userId, message: row.message, requestId: row.requestId, createdAt: row.createdAt,
    })),
  };
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: ExportRow[]) {
  const sheet = workbook.addWorksheet(name.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ["No records"];
  sheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(42, Math.max(14, key.length + 3)),
  }));
  // Excel refuses cells above 32,767 characters (the raw AI response can be larger) and would offer to "repair" the file.
  const LIMIT = 32000;
  const fit = (v: CellValue) => (typeof v === "string" && v.length > LIMIT ? `${v.slice(0, LIMIT)} ...[cut: use the JSON export for the full text]` : v);
  rows.forEach((row) => sheet.addRow(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, fit(v)]))));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171717" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin();
  } catch (error) {
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "Only administrators can export data." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }
  const db = scoped(admin);
  const url = new URL(request.url);
  const requested = url.searchParams.get("dataset") ?? "all";
  const format = url.searchParams.get("format") === "json" ? "json" : "xlsx";
  const selected = requested === "all"
    ? [...DATASETS]
    : DATASETS.includes(requested as Dataset)
      ? [requested as Dataset]
      : null;

  if (!selected) return Response.json({ error: "Unknown export dataset." }, { status: 400 });
  const company = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true, name: true, displayName: true } });
  const slug = company?.slug ?? "company";
  const data = await loadData(admin.orgId, db);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const payload = Object.fromEntries(selected.map((dataset) => [dataset, data[dataset]]));
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), data: payload }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-backup-${stamp}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = company?.displayName || company?.name || "Invoice & Billing";
  workbook.created = new Date();
  selected.forEach((dataset) => addSheet(workbook, dataset, data[dataset]));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}-${requested}-${stamp}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
