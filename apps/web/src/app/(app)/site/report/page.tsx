import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { companyToday, getReport, listPhotos } from "@/lib/flows/site";
import { canEditReport, isYmd } from "@/lib/site/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhotoGrid } from "../photo-grid";
import { PhotoUploader } from "../photo-uploader";
import { ReportStatusBadge } from "../badges";
import { ReportForm } from "../report-form";

type Params = Promise<{ project?: string; date?: string }>;

export default async function ReportPage({ searchParams }: { searchParams: Params }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const params = await searchParams;
  const scope = await getProjectScope(user);
  const today = await companyToday(user.orgId);
  const project = scope.projects.find((p) => p.id === params.project) ?? scope.projects.find((p) => p.id === scope.selectedProjectId) ?? scope.projects[0];
  if (!project) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">You are not on any project yet. Ask an administrator to assign you.</CardContent></Card>;
  }
  const date = isYmd(params.date) && params.date <= today ? params.date : today;
  const report = await getReport(user, project.id, date);
  const photos = report ? await listPhotos(user, { reportId: report.id, take: 60 }) : [];
  const canWrite = hasPermission(user.role, "site:write");
  const canManage = hasPermission(user.role, "site:manage");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/site" />}><ArrowLeft className="size-4" aria-hidden /> Site work</Button>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">Daily report <ReportStatusBadge status={report?.status ?? null} /></h1>
          <p className="text-sm text-muted-foreground">
            {project.name} · {date}
            {report?.authorName && ` · written by ${report.authorName}`}
            {report?.submittedByName && ` · submitted by ${report.submittedByName}`}
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Choose project and day">
          {scope.projects.length > 1 && (
            <select name="project" defaultValue={project.id} aria-label="Project" className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {scope.projects.length <= 1 && <input type="hidden" name="project" value={project.id} />}
          <Input type="date" name="date" defaultValue={date} max={today} aria-label="Day" className="w-auto" />
          <Button type="submit" variant="outline" size="sm">Go</Button>
        </form>
      </div>

      {!report && !canWrite ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No report was written for this day.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">{report ? "Report" : "Write the report"}</CardTitle></CardHeader>
          <CardContent>
            <ReportForm
              key={`${project.id}-${date}-${report?.status ?? "new"}-${report?.submittedAt?.toISOString() ?? ""}`}
              projectId={project.id}
              date={date}
              reportId={report?.id ?? null}
              status={report?.status ?? null}
              values={{
                weather: report?.weather ?? "", workDone: report?.workDone ?? "", labourCount: report?.labourCount?.toString() ?? "", machinery: report?.machinery ?? "",
                materialsUsed: report?.materialsUsed ?? "", problems: report?.problems ?? "", safetyNote: report?.safetyNote ?? "",
              }}
              canEdit={report ? report.canEdit : canWrite}
              canSubmit={report ? report.canSubmit : canWrite}
              canReopen={report?.canReopen ?? false}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Photos for this day</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {!report ? (
            <p className="text-sm text-muted-foreground">Save the report first, then add photos to it.</p>
          ) : (
            <>
              {canEditReport(report.status, canWrite, canManage) && <PhotoUploader projectId={project.id} reportId={report.id} />}
              {report.status === "SUBMITTED" && !report.canEdit && <p className="text-sm text-muted-foreground">This report is submitted, so photos cannot be added or removed.</p>}
              <PhotoGrid photos={photos} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
