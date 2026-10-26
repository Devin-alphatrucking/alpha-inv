import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Camera, ClipboardList, HardHat } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { listIssues, listPhotos, listReports, siteOverview } from "@/lib/flows/site";
import { isOverdue, issueOrder } from "@/lib/site/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhotoGrid } from "./photo-grid";
import { IssueStatusBadge, ReportStatusBadge, SeverityBadge } from "./badges";

export default async function SitePage() {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const canWrite = hasPermission(user.role, "site:write");
  const [overview, reports, photos, issues] = await Promise.all([
    siteOverview(user),
    listReports(user, { take: 8 }),
    listPhotos(user, { take: 8 }),
    listIssues(user, { status: ["OPEN", "IN_PROGRESS"], take: 100 }),
  ]);
  const today = overview.today;
  const urgent = [...issues].sort((a, b) => issueOrder({ ...a, createdAt: a.createdAt }, { ...b, createdAt: b.createdAt })).slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><HardHat className="size-6" aria-hidden /> Site work</h1>
          <p className="text-sm text-muted-foreground">Daily reports, photos and issues from site, for the projects you work on.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/site/photos" />}><Camera className="size-4" aria-hidden /> Photos</Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/site/issues" />}><AlertTriangle className="size-4" aria-hidden /> Issues</Button>
        </div>
      </div>

      <section aria-labelledby="today-h" className="grid gap-3">
        <h2 id="today-h" className="text-sm font-medium text-muted-foreground">Today ({today})</h2>
        {overview.projects.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">You are not on any active project yet. Ask an administrator to assign you.</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {overview.projects.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="truncate text-base">{p.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span>Today&rsquo;s report</span> <ReportStatusBadge status={p.todayReport} />
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    {p.openIssues} open {p.openIssues === 1 ? "issue" : "issues"}
                    {p.overdueIssues > 0 && <span className="font-medium text-destructive"> · {p.overdueIssues} overdue</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={p.todayReport || !canWrite ? "outline" : "default"} nativeButton={false} render={<Link href={`/site/report?project=${p.id}&date=${today}`} />}>
                      {p.todayReport ? "Open report" : canWrite ? "Write today’s report" : "No report yet"}
                    </Button>
                    <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/site/issues?project=${p.id}`} />}>Issues</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" aria-hidden /> Issues needing attention</CardTitle></CardHeader>
          <CardContent>
            {urgent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing open. Good.</p> : (
              <ul className="divide-y">
                {urgent.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <Link href={`/site/issues/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 hover:underline">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                      <span className="flex items-center gap-1.5"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} overdue={isOverdue({ status: i.status, dueDate: i.dueDate }, today)} /></span>
                    </Link>
                    <p className="text-xs text-muted-foreground">{[i.projectName, i.area, i.dueDate ? `due ${i.dueDate}` : null].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="size-4" aria-hidden /> Recent reports</CardTitle></CardHeader>
          <CardContent>
            {reports.length === 0 ? <p className="text-sm text-muted-foreground">No reports yet.</p> : (
              <ul className="divide-y">
                {reports.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <Link href={`/site/report?project=${r.projectId}&date=${r.reportDate}`} className="flex flex-wrap items-center justify-between gap-2 hover:underline">
                      <span className="text-sm font-medium">{r.projectName} · {r.reportDate}</span>
                      <ReportStatusBadge status={r.status} />
                    </Link>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{r.workDone}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Camera className="size-4" aria-hidden /> Latest photos</CardTitle></CardHeader>
        <CardContent><PhotoGrid photos={photos} showProject /></CardContent>
      </Card>
    </div>
  );
}
