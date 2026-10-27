import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getFormat } from "@/lib/brand/brand";
import { companyToday } from "@/lib/flows/site";
import { getDocument } from "@/lib/flows/documents";
import { CATEGORY_LABEL, humanSize, nextRevisionLabel } from "@/lib/site/document-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveButton } from "../archive-button";
import { DocumentForm } from "../document-form";

export default async function DrawingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const { id } = await params;
  const doc = await getDocument(user, id);
  if (!doc) notFound();
  const fmt = await getFormat();
  const date = (s: string) => fmt.date(new Date(`${s}T00:00:00Z`));
  const today = await companyToday(user.orgId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href={`/site/drawings?project=${doc.projectId}`} />}><ArrowLeft className="size-4" aria-hidden /> Drawings</Button>
        <h1 className="break-words text-2xl font-semibold tracking-tight">{doc.number ? `${doc.number} · ` : ""}{doc.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{CATEGORY_LABEL[doc.category]}</Badge>
          {doc.archived && <Badge variant="destructive">Archived</Badge>}
          <span>{doc.projectName}</span>
        </p>
        {doc.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{doc.description}</p>}
      </div>

      {doc.current && (
        <Card>
          <CardHeader><CardTitle className="text-base">Current revision: {doc.current.revision}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{doc.current.formatLabel}, {humanSize(doc.current.sizeBytes)} · issued {date(doc.current.issuedOn)}{doc.current.uploadedByName ? ` by ${doc.current.uploadedByName}` : ""}</p>
            {doc.current.note && <p className="whitespace-pre-wrap break-words text-sm">{doc.current.note}</p>}
            <div>
              <Button nativeButton={false} render={<a href={`/api/site/documents/file/${doc.current.id}`} target="_blank" rel="noreferrer" />}>
                {doc.current.opensInPage ? <ExternalLink className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />} {doc.current.opensInPage ? "Open" : "Download"} {doc.current.fileName}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Revision history ({doc.revisionCount})</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {doc.revisions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Revision {r.revision} {r.isCurrent && <Badge variant="secondary">Current</Badge>}</p>
                  <p className="text-xs text-muted-foreground">issued {date(r.issuedOn)}{r.uploadedByName ? ` by ${r.uploadedByName}` : ""} · {r.formatLabel}, {humanSize(r.sizeBytes)}</p>
                  {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.note}</p>}
                </div>
                <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/site/documents/file/${r.id}`} target="_blank" rel="noreferrer" />}>
                  {r.opensInPage ? "Open" : "Download"}
                </Button>
              </li>
            ))}
          </ul>
          {!doc.current?.isCurrent ? null : <p className="mt-3 text-xs text-muted-foreground">Build from the current revision only. An older one is kept for the record.</p>}
        </CardContent>
      </Card>

      {doc.canWrite && (
        <>
          {!doc.archived && (
            <Card>
              <CardHeader><CardTitle className="text-base">Add a new revision</CardTitle></CardHeader>
              <CardContent><DocumentForm key={doc.current?.id} documentId={doc.id} suggestedRevision={nextRevisionLabel(doc.current?.revision)} today={today} /></CardContent>
            </Card>
          )}
          <div><ArchiveButton documentId={doc.id} archived={doc.archived} /></div>
        </>
      )}
    </div>
  );
}
