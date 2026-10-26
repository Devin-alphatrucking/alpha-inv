import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { requirePermission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { comparePrices, parseMonths, sinceDate } from "@/lib/invoices/price-compare";
import { loadPurchaseLines } from "@/lib/invoices/price-compare-load";
import { toCsv } from "@/lib/gst/report";

export const runtime = "nodejs";

/** GET /api/reports/price-compare[?months=12&project=<id>]: every item bought from 2+ suppliers, one row per supplier, as a CSV. Roles with access only. */
export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requirePermission>>;
  try {
    admin = await requirePermission("price:compare");
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "You do not have access to the price comparison." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }
  const url = new URL(request.url);
  const db = dbFor(admin.orgId);
  const projectId = url.searchParams.get("project") || null;
  if (projectId && !(await db.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return Response.json({ error: "Project not found." }, { status: 404 });

  const months = parseMonths(url.searchParams.get("months"));
  const today = todayIn(await companyTimeZone(admin.orgId));
  const since = sinceDate(today, months);
  const { lines } = await loadPurchaseLines(db, { since, projectId });
  const items = comparePrices(lines, { includeSmall: url.searchParams.get("all") === "1" });

  const csv = toCsv(
    ["Item", "Unit", "Supplier", "Cheapest", "Quantity bought", "Average rate (before GST)", "Last rate", "Last bought", "Above cheapest %", "Extra paid vs cheapest"],
    items.flatMap((i) => i.suppliers.map((s) => [i.description, i.unit, s.vendorName, s.vendorId === i.cheapestId ? "yes" : "", s.quantity, s.avgRate.toFixed(2), s.lastRate.toFixed(2), s.lastDate, s.premiumPercent.toFixed(2), s.extraPaid.toFixed(2)])),
  );
  const company = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true } });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${company?.slug ?? "company"}-price-comparison-${since}-to-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
