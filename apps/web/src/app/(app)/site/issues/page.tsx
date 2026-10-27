import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { assignableUsers, companyToday, listIssues } from "@/lib/flows/site";
import { isOverdue, issueOrder, ISSUE_STATUSES, STATUS_LABEL, summariseIssues, type IssueState } from "@/lib/site/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IssueStatusBadge, SeverityBadge } from "../badges";
import { IssueForm } from "./issue-form";
import { NativeSelect } from "@/components/ui/native-select";

type Params = Promise<{ project?: string; status?: string }>;

export default async function IssuesPage({ searchParams }: { searchParams: Params }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const params = await searchParams;
  const scope = await getProjectScope(user);
  const today = await companyToday(user.orgId);
  const projectId = scope.projects.some((p) => p.id === params.project) ? params.project! : null;
  const filter = (ISSUE_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as IssueState) : null;
  const all = await listIssues(user, { projectId, take: 500 });
  const counts = summariseIssues(all, today);
  const shown = (filter ? all.filter((i) => i.status === filter) : all.filter((i) => i.status !== "CLOSED")).sort(issueOrder);
  const raiseIn = projectId ?? scope.selectedProjectId ?? scope.projects[0]?.id ?? null;
  const people = raiseIn && hasPermission(user.role, "site:write") ? await assignableUsers(user, raiseIn) : [];
  const link = (status?: string) => `/site/issues?${new URLSearchParams({ ...(projectId ? { project: projectId } : {}), ...(status ? { status } : {}) }).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/site" />}><ArrowLeft className="size-4" aria-hidden /> Site work</Button>
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="text-sm text-muted-foreground">Problems found on site, who must fix them, and by when.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter">
        <Button size="sm" variant={!filter ? "default" : "outline"} nativeButton={false} render={<Link href={link()} />}>Not closed ({counts.open + counts.inProgress + counts.fixed})</Button>
        {ISSUE_STATUSES.map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} nativeButton={false} render={<Link href={link(s)} />}>
            {STATUS_LABEL[s]} ({s === "OPEN" ? counts.open : s === "IN_PROGRESS" ? counts.inProgress : s === "FIXED" ? counts.fixed : counts.closed})
          </Button>
        ))}
        {counts.overdue > 0 && <span className="text-sm font-medium text-destructive">{counts.overdue} overdue</span>}
        {scope.projects.length > 1 && (
          <form method="get" className="ml-auto flex items-center gap-2">
            {filter && <input type="hidden" name="status" value={filter} />}
            <NativeSelect name="project" defaultValue={projectId ?? ""} aria-label="Project">
              <option value="">All projects</option>
              {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No issues here.</p>
          ) : (
            <ul className="divide-y">
              {shown.map((i) => (
                <li key={i.id}>
                  <Link href={`/site/issues/${i.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                      <span className="flex items-center gap-1.5"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} overdue={isOverdue({ status: i.status, dueDate: i.dueDate }, today)} /></span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[i.projectName, i.area, i.assigneeName ? `given to ${i.assigneeName}` : "not given to anyone", i.dueDate ? `due ${i.dueDate}` : null, i.photoCount ? `${i.photoCount} photo${i.photoCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {raiseIn && hasPermission(user.role, "site:write") && (
        <Card id="raise">
          <CardHeader>
            <CardTitle className="text-base">Raise an issue</CardTitle>
            {scope.projects.length > 1 && <p className="text-sm text-muted-foreground">On {scope.projects.find((p) => p.id === raiseIn)?.name}. Choose a project above to raise it elsewhere.</p>}
          </CardHeader>
          <CardContent><IssueForm key={raiseIn} projectId={raiseIn} people={people} /></CardContent>
        </Card>
      )}
    </div>
  );
}
