import { rawDb } from "@/lib/db";
import { scoped } from "@/lib/org/context";
import { requireAdmin } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { exportResponse, parseDataset } from "@/lib/export/company-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "Only administrators can export data." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }
  const db = scoped(admin);
  const url = new URL(request.url);
  const requested = url.searchParams.get("dataset") ?? "all";
  const format = url.searchParams.get("format") === "json" ? "json" : "xlsx";
  const datasets = parseDataset(requested);

  if (!datasets) return Response.json({ error: "Unknown export dataset." }, { status: 400 });
  const company = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true, name: true, displayName: true } });
  return exportResponse({
    orgId: admin.orgId,
    db,
    company: { slug: company?.slug ?? "company", label: company?.displayName || company?.name || "Invoice & Billing" },
    datasets,
    requested,
    format,
  });
}
