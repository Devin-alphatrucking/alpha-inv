import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { assignableUsers, companyToday, getIssue, listPhotos } from "@/lib/flows/site";
import { isOverdue } from "@/lib/site/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IssueStatusBadge, SeverityBadge } from "../../badges";
import { PhotoGrid } from "../../photo-grid";
import { PhotoUploader } from "../../photo-uploader";
import { IssueForm } from "../issue-form";
import { IssueStatusButtons } from "../issue-status";

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const { id } = await params;
  const issue = await getIssue(user, id);
  if (!issue) notFound();
  const today = await companyToday(user.orgId);
  const [photos, people] = await Promise.all([listPhotos(user, { issueId: issue.id, take: 60 }), issue.canEdit ? assignableUsers(user, issue.projectId) : Promise.resolve([])]);
  const canWrite = hasPermission(user.role, "site:write");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/site/issues" />}><ArrowLeft className="size-4" aria-hidden /> Issues</Button>
        <h1 className="break-words text-2xl font-semibold tracking-tight">{issue.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SeverityBadge severity={issue.severity} />
          <IssueStatusBadge status={issue.status} overdue={isOverdue({ status: issue.status, dueDate: issue.dueDate }, today)} />
          <span>{[issue.projectName, issue.area, issue.dueDate ? `fix by ${issue.dueDate}` : null].filter(Boolean).join(" · ")}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Raised by {issue.raisedByName ?? "a former member"} on {issue.createdAt.toISOString().slice(0, 10)} · {issue.assigneeName ? `given to ${issue.assigneeName}` : "not given to anyone"}
          {issue.resolvedAt && ` · ${issue.status === "CLOSED" ? "closed" : "marked fixed"} ${issue.resolvedAt.toISOString().slice(0, 10)}`}
        </p>
      </div>

      {issue.description && <Card><CardContent className="whitespace-pre-wrap break-words py-4 text-sm leading-relaxed">{issue.description}</CardContent></Card>}

      {canWrite && (
        <Card>
          <CardHeader><CardTitle className="text-base">Move it along</CardTitle></CardHeader>
          <CardContent><IssueStatusButtons issueId={issue.id} status={issue.status} next={issue.next} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Photos</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {canWrite && <PhotoUploader projectId={issue.projectId} issueId={issue.id} />}
          <PhotoGrid photos={photos} />
        </CardContent>
      </Card>

      {issue.canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base">Change the details</CardTitle></CardHeader>
          <CardContent>
            <IssueForm
              projectId={issue.projectId}
              issueId={issue.id}
              people={people}
              initial={{ title: issue.title, description: issue.description ?? "", area: issue.area ?? "", severity: issue.severity, dueDate: issue.dueDate ?? "", assigneeId: issue.assigneeId ?? "" }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
