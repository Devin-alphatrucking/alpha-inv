import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { requirePermission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { loadOwed } from "@/lib/invoices/planner-load";
import { plain, toCsv } from "@/lib/gst/report";

export const runtime = "nodejs";

/** GET /api/reports/payables[?project=<id>]: everything still owed, soonest due first, as a CSV for the person who makes the payments. Roles with access only. */
export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requirePermission>>;
  try {
    admin = await requirePermission("payment:plan");
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "You do not have access to the payables list." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }

  const db = dbFor(admin.orgId);
  const projectId = new URL(request.url).searchParams.get("project") || null;
  if (projectId && !(await db.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return Response.json({ error: "Project not found." }, { status: 404 });

  const today = todayIn(await companyTimeZone(admin.orgId));
  const owed = await loadOwed(db, projectId ? { projectId } : {}, today);
  const csv = toCsv(
    ["Supplier", "Invoice number", "Project", "Due date", "Days late", "Balance owed"],
    owed.map((o) => [o.vendorName, o.invoiceNumber, o.projectName, o.dueDate ? o.dueDate.toISOString().slice(0, 10) : "", o.daysLate === null ? "" : Math.max(0, o.daysLate), plain(o.balanceMinor)]),
  );
  const company = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true } });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${company?.slug ?? "company"}-payables-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
