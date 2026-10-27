import { flow, json, need, readJson, requireMobile, route } from "@/lib/mobile/http";
import { companyToday, createIssue, listIssues } from "@/lib/flows/site";
import { ISSUE_STATUSES, issueOrder, summariseIssues, type IssueState } from "@/lib/site/rules";

export const runtime = "nodejs";

/** GET ?projectId=&status=OPEN,IN_PROGRESS: issues the person may see, most serious first, with counts. */
export const GET = route("/api/v1/site/issues", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const sp = new URL(req.url).searchParams;
  const wanted = (sp.get("status") ?? "").split(",").filter((s): s is IssueState => (ISSUE_STATUSES as readonly string[]).includes(s));
  const all = await listIssues(me, { projectId: sp.get("projectId"), take: 500 });
  const today = await companyToday(me.orgId);
  const counts = summariseIssues(all, today);
  const issues = (wanted.length ? all.filter((i) => wanted.includes(i.status)) : all.filter((i) => i.status !== "CLOSED")).sort(issueOrder);
  return json({ today, counts, issues: issues.slice(0, 200) });
});

/** POST { projectId, title, description, area, severity, dueDate, assigneeId }: raises an issue. */
export const POST = route("/api/v1/site/issues", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:write");
  const body = (await readJson(req)) as Record<string, unknown>;
  return flow(await createIssue(me, typeof body.projectId === "string" ? body.projectId : "", body, body.clientRef), 201);
});
