import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { requirePermission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn, toMinor } from "@/lib/invoices/status";
import { loadGstInvoices } from "@/lib/gst/load";
import { buildGstReport, invoiceTaxMinor, parsePeriod, plain, toCsv } from "@/lib/gst/report";

export const runtime = "nodejs";

const VIEWS = ["invoices", "vendors", "months"] as const;
type View = (typeof VIEWS)[number];

/** GET /api/reports/gst?view=invoices|vendors|months&fy=2026 (or from=&to=)&project=<id>: the GST summary as a CSV file. Roles with access only. */
export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requirePermission>>;
  try {
    admin = await requirePermission("report:view");
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "You do not have access to the GST report." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get("view") ?? "invoices";
  if (!VIEWS.includes(requested as View)) return Response.json({ error: "Unknown report view." }, { status: 400 });
  const view = requested as View;

  const db = dbFor(admin.orgId);
  const period = parsePeriod({ fy: url.searchParams.get("fy"), from: url.searchParams.get("from"), to: url.searchParams.get("to") }, todayIn(await companyTimeZone(admin.orgId)));
  const projectId = url.searchParams.get("project") || null;
  if (projectId && !(await db.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return Response.json({ error: "Project not found." }, { status: 404 });

  const invoices = await loadGstInvoices(db, period, projectId);
  const report = buildGstReport(invoices);

  let csv: string;
  if (view === "invoices") {
    csv = toCsv(
      ["Invoice date", "Invoice number", "Vendor", "Vendor GSTIN", "Project", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Rounding", "Invoice total", "Status"],
      invoices.map((i) => [i.invoiceDate.toISOString().slice(0, 10), i.invoiceNumber, i.vendorName, i.vendorGstin, i.projectName, plain(toMinor(i.subtotal)), plain(toMinor(i.cgst)), plain(toMinor(i.sgst)), plain(toMinor(i.igst)), plain(invoiceTaxMinor(i)), plain(toMinor(i.rounding)), plain(toMinor(i.total)), i.status]),
    );
  } else if (view === "vendors") {
    csv = toCsv(
      ["Vendor", "Vendor GSTIN", "Invoices", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Invoice total"],
      report.vendors.map((v) => [v.name, v.gstin, v.invoices, plain(v.taxableMinor), plain(v.cgstMinor), plain(v.sgstMinor), plain(v.igstMinor), plain(v.taxMinor), plain(v.totalMinor)]),
    );
  } else {
    csv = toCsv(
      ["Month", "Invoices", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Invoice total"],
      report.months.map((m) => [m.month, m.invoices, plain(m.taxableMinor), plain(m.cgstMinor), plain(m.sgstMinor), plain(m.igstMinor), plain(m.taxMinor), plain(m.totalMinor)]),
    );
  }

  const company = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true } });
  const filename = `${company?.slug ?? "company"}-gst-${view}-${period.from}-to-${period.to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
