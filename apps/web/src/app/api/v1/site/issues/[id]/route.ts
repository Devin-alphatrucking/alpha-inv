import { flow, json, need, notFound, readJson, requireMobile, route } from "@/lib/mobile/http";
import { assignableUsers, getIssue, listPhotos, setIssueStatus, updateIssue } from "@/lib/flows/site";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** One issue with its photos and the people it can be given to. `next` lists the steps this person may take. */
export const GET = route<Ctx>("/api/v1/site/issues/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const { id } = await ctx.params;
  const issue = await getIssue(me, id);
  if (!issue) return notFound("Issue");
  const [photos, people] = await Promise.all([listPhotos(me, { issueId: id, take: 60 }), issue.canEdit ? assignableUsers(me, issue.projectId) : Promise.resolve([])]);
  return json({ issue, photos, people });
});

/** PATCH { title, description, area, severity, dueDate, assigneeId }: changes the details (whoever raised it, whoever holds it, or a manager). */
export const PATCH = route<Ctx>("/api/v1/site/issues/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:write");
  const { id } = await ctx.params;
  return flow(await updateIssue(me, id, await readJson(req)));
});

/** POST { status }: the next step (open, in progress, fixed; only a manager closes). */
export const POST = route<Ctx>("/api/v1/site/issues/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:write");
  const { id } = await ctx.params;
  const { status } = (await readJson(req)) as { status?: unknown };
  return flow(await setIssueStatus(me, id, status));
});
