import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";
import { companyToday } from "@/lib/flows/site";
import { listDocuments } from "@/lib/flows/documents";
import { CATEGORIES, CATEGORY_LABEL, humanSize } from "@/lib/site/document-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DocumentForm } from "./document-form";

type Params = Promise<{ project?: string; category?: string; q?: string }>;

export default async function DrawingsPage({ searchParams }: { searchParams: Params }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const params = await searchParams;
  const scope = await getProjectScope(user);
  const fmt = await getFormat();
  const projectId = scope.projects.some((p) => p.id === params.project) ? params.project! : scope.selectedProjectId;
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? "") ? params.category! : "";
  const docs = await listDocuments(user, { projectId, category, q: params.q });
  const canWrite = hasPermission(user.role, "document:write");
  const addTo = projectId ?? scope.projects.find((p) => p.status === "ACTIVE")?.id ?? null;
  const today = await companyToday(user.orgId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/site" />}><ArrowLeft className="size-4" aria-hidden /> Site work</Button>
        <h1 className="text-2xl font-semibold tracking-tight">Drawings and documents</h1>
        <p className="text-sm text-muted-foreground">The current revision of each drawing is the one to build from. Older revisions stay in the history.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Find drawings">
        {scope.projects.length > 1 && (
          <select name="project" defaultValue={projectId ?? ""} aria-label="Project" className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">All projects</option>
            {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select name="category" defaultValue={category} aria-label="Category" className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <Input name="q" defaultValue={params.q ?? ""} placeholder="Title or number" aria-label="Search" className="w-auto" />
        <Button type="submit" variant="outline" size="sm">Show</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {docs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No drawings here{canWrite ? ". Add the first one below." : "."}</p>
          ) : (
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link href={`/site/drawings/${d.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{d.number ? `${d.number} · ` : ""}{d.title}</span></span>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline">{CATEGORY_LABEL[d.category]}</Badge>
                        {d.current && <Badge variant="secondary">Rev {d.current.revision}</Badge>}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[d.projectName, d.current ? `${d.current.formatLabel}, ${humanSize(d.current.sizeBytes)}` : null, d.current ? `issued ${fmt.date(new Date(`${d.current.issuedOn}T00:00:00Z`))}` : null, d.revisionCount > 1 ? `${d.revisionCount} revisions` : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite && addTo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a drawing or document</CardTitle>
            {scope.projects.length > 1 && <p className="text-sm text-muted-foreground">To {scope.projects.find((p) => p.id === addTo)?.name}. Choose a project above to add to another one.</p>}
          </CardHeader>
          <CardContent><DocumentForm key={addTo} projectId={addTo} suggestedRevision="A" today={today} /></CardContent>
        </Card>
      )}
    </div>
  );
}
