import { flow, json, need, notFound, readJson, requireMobile, route } from "@/lib/mobile/http";
import { getReport, listPhotos, listReports, saveReport } from "@/lib/flows/site";
import { isYmd } from "@/lib/site/rules";

export const runtime = "nodejs";

/**
 * GET ?projectId=&date=YYYY-MM-DD: that day's report (or `report: null`) with its photos.
 * GET ?projectId= (no date): the latest reports of that project. GET with neither: the latest across the person's projects.
 */
export const GET = route("/api/v1/site/reports", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("projectId");
  const date = sp.get("date");
  if (projectId && date) {
    if (!isYmd(date)) return json({ error: "Date must be YYYY-MM-DD.", code: "rejected", field: "date" }, 400);
    const report = await getReport(me, projectId, date);
    const photos = report ? await listPhotos(me, { reportId: report.id, take: 60 }) : [];
    return json({ report, photos });
  }
  return json({ reports: await listReports(me, { projectId, take: 30 }) });
});

/** PUT { projectId, reportDate, weather, workDone, labourCount, machinery, materialsUsed, problems, safetyNote }: saves the day's draft (creates it or changes it). */
export const PUT = route("/api/v1/site/reports", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:write");
  const body = (await readJson(req)) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const saved = await saveReport(me, projectId, body);
  if (!saved.ok) return flow(saved);
  const date = typeof body.reportDate === "string" ? body.reportDate : "";
  const report = await getReport(me, projectId, date);
  return report ? json({ ok: true, report }) : notFound("Report");
});
