import { requirePermission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { exportCsv, type ExportKind } from "@/lib/flows/sales";

export const runtime = "nodejs";

/** GET ?kind=b2b|hsn|invoices&from=YYYY-MM-DD&to=YYYY-MM-DD: a CSV for the accountant (Sales add-on). Roles with sales access only, and only when the add-on is on. */
export async function GET(req: Request) {
  let user: Awaited<ReturnType<typeof requirePermission>>;
  try {
    user = await requirePermission("sales:view");
  } catch (error) {
    if (error instanceof AppError && error.code === "PLAN_LOCKED") return Response.json({ error: error.message, code: error.code }, { status: 402 });
    const forbidden = error instanceof AppError && error.code === "PERMISSION_001";
    return Response.json({ error: forbidden ? "You do not have access to sales invoices." : "Authentication required." }, { status: forbidden ? 403 : 401 });
  }
  const sp = new URL(req.url).searchParams;
  const kind = (["b2b", "hsn", "invoices"] as const).find((k) => k === sp.get("kind")) as ExportKind | undefined;
  if (!kind) return Response.json({ error: "Choose which file you want." }, { status: 400 });
  const r = await exportCsv({ id: user.id, orgId: user.orgId, role: user.role }, kind, sp.get("from") ?? "", sp.get("to") ?? "");
  if (!r.ok) return Response.json({ error: r.error }, { status: /switched on|access/.test(r.error) ? 403 : 400 });
  return new Response(r.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.filename}"`, "Cache-Control": "private, no-store" },
  });
}
