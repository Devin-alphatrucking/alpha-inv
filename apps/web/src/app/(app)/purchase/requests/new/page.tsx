import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestForm } from "../request-form";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "request:write")) redirect("/purchase");
  const params = await searchParams;
  const scope = await getProjectScope(user);
  const active = scope.projects.filter((p) => p.status === "ACTIVE");
  const project = active.find((p) => p.id === params.project) ?? active.find((p) => p.id === scope.selectedProjectId) ?? active[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase" />}><ArrowLeft className="size-4" aria-hidden /> Purchase</Button>
        <h1 className="text-2xl font-semibold tracking-tight">New material request</h1>
        {project && (
          <form method="get" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>For</span>
            {active.length > 1 ? (
              <>
                <select name="project" defaultValue={project.id} aria-label="Project" className="h-9 rounded-xl border border-input bg-background px-3 text-sm text-foreground">
                  {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Button type="submit" variant="outline" size="sm">Change</Button>
              </>
            ) : <span className="font-medium text-foreground">{project.name}</span>}
          </form>
        )}
      </div>
      {!project ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">You are not on any active project. Ask an administrator to assign you.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">What is needed</CardTitle></CardHeader>
          <CardContent><RequestForm key={project.id} projectId={project.id} /></CardContent>
        </Card>
      )}
    </div>
  );
}
