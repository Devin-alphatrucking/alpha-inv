import { rawDb } from "@/lib/db";
import { dbFor } from "@/lib/org/scoped-db";
import { AppError, isAppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { currentPlatformAdmin } from "@/lib/master/guard";
import { parseReason } from "@/lib/master/ops";
import { exportResponse, parseDataset } from "@/lib/export/company-data";

export const runtime = "nodejs";

/**
 * POST /api/master/export (form: orgId, reason, format): a platform operator downloads ONE company's data, for example when the
 * company asks for a copy or is leaving. Needs the same two-step sign-in as the rest of the console, a written reason, and is
 * written to that company's activity log. A form post (not a link) so the reason travels with it.
 */
export async function POST(request: Request) {
  const admin = await currentPlatformAdmin();
  // The same plain answer for everyone who is not an operator, so the console's existence is not revealed.
  if (!admin) return Response.json({ error: "Not found." }, { status: 404 });
  if (!admin.twoStep) return Response.json({ error: "Turn on two-step sign-in on your Account page to use the master console." }, { status: 403 });

  // A page on another website must not be able to make an operator's browser download a company's data.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return Response.json({ error: "Not allowed." }, { status: 403 });

  const form = await request.formData();
  const orgId = String(form.get("orgId") ?? "");
  const format = form.get("format") === "json" ? "json" : "xlsx";
  try {
    const reason = parseReason(form.get("reason"));
    const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { id: true, slug: true, name: true, displayName: true } });
    if (!org) throw new AppError("NOT_FOUND_001", "Company not found.");

    await logActivity({ userId: admin.id, organizationId: org.id, action: "MASTER_EXPORTED_COMPANY", module: "MASTER", entityId: org.id, details: { by: admin.email, reason, format } });
    return await exportResponse({
      orgId: org.id,
      db: dbFor(org.id),
      company: { slug: org.slug, label: org.displayName || org.name },
      datasets: parseDataset("all")!,
      requested: "all",
      format,
    });
  } catch (error) {
    if (isAppError(error)) return Response.json({ error: error.message }, { status: error.code === "NOT_FOUND_001" ? 404 : 400 });
    console.error("[master export]", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not prepare the export." }, { status: 500 });
  }
}
