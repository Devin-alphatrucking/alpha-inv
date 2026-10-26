import { flow, readJson, requireMobile, route } from "@/lib/mobile/http";
import { reopenReport, submitReport } from "@/lib/flows/site";

export const runtime = "nodejs";

/** POST { action: "submit" | "reopen" }: submitting locks the day's report; a project manager can reopen it. */
export const POST = route<{ params: Promise<{ id: string }> }>("/api/v1/site/reports/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  const { id } = await ctx.params;
  const { action } = (await readJson(req)) as { action?: string };
  if (action === "submit") return flow(await submitReport(me, id));
  if (action === "reopen") return flow(await reopenReport(me, id));
  return flow({ ok: false, error: "Unknown action.", field: "action" });
});
