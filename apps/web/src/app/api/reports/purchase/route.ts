import { rawDb } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { loadPurchaseReport } from "@/lib/flows/purchase-report";
import { plain, toCsv } from "@/lib/gst/report";

export const runtime = "nodejs";

const VIEWS = ["projects", "suppliers", "open"] as const;
type View = (typeof VIEWS)[number];

/** GET /api/reports/purchase?view=projects|suppliers|open&project=<id>&from=&to=: the purchase report as a CSV file (amounts in plain numbers, no symbols). */
export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requirePermission>>;
  try {
    user = await requirePermission("order:view");
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "You do not have access to the purchase report." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("view") ?? "projects";
  if (!VIEWS.includes(requested as View)) return Response.json({ error: "Unknown report view." }, { status: 400 });
  const view = requested as View;

  const report = await loadPurchaseReport(user, { projectId: url.searchParams.get("project") || null, from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!report) return Response.json({ error: "You do not have access to the purchase report." }, { status: 403 });

  let csv: string;
  if (view === "projects") {
    const header = ["Project", "Orders", "Ordered", "Still to deliver", "Delivered, not billed", "Billed against orders", "Billed (all bills)", "Paid", "To pay", "Expected cost", ...(report.showBudget ? ["Budget", "Budget status"] : [])];
    csv = toCsv(header, report.projects.map((p) => [p.name, p.orders, plain(p.committedMinor), plain(p.toDeliverMinor), plain(p.awaitingBillMinor), plain(p.billedOnOrdersMinor), plain(p.billedAllMinor), plain(p.paidMinor), plain(p.outstandingMinor), plain(p.expectedMinor), ...(report.showBudget ? [p.budgetMinor === null ? "" : plain(p.budgetMinor), p.budgetStatus] : [])]));
  } else if (view === "suppliers") {
    csv = toCsv(
      ["Supplier", "Orders", "Value", "Orders measured", "Delivered on time", "On time %", "Average delay (days)", "Fill %", "Refused %", "Late now"],
      report.suppliers.map((s) => [s.name, s.orders, plain(s.valueMinor), s.measured, s.onTime, s.onTimePercent ?? "", s.averageDelayDays ?? "", s.fillPercent ?? "", s.refusedPercent ?? "", s.lateOpen]),
    );
  } else {
    csv = toCsv(
      ["Order", "Supplier", "Project", "Status", "Due", "Days late", "Received %", "Still to deliver"],
      report.open.map((o) => [o.number, o.vendorName, o.projectName, o.status, o.deliveryDate ?? "", o.daysLate, o.receivedPercent, plain(o.toDeliverMinor)]),
    );
  }

  const company = await rawDb.organization.findUnique({ where: { id: user.orgId }, select: { slug: true } });
  const filename = `${company?.slug ?? "company"}-purchase-${view}-${view === "suppliers" ? `${report.period.from}-to-${report.period.to}` : report.today}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
}
