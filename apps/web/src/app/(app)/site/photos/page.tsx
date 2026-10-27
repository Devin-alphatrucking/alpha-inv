import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { listPhotos } from "@/lib/flows/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PhotoGrid } from "../photo-grid";
import { PhotoUploader } from "../photo-uploader";
import { NativeSelect } from "@/components/ui/native-select";

export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "site:view")) redirect("/dashboard");
  const params = await searchParams;
  const scope = await getProjectScope(user);
  const projectId = scope.projects.some((p) => p.id === params.project) ? params.project! : null;
  const photos = await listPhotos(user, { projectId, take: 120 });
  const uploadTo = projectId ?? scope.selectedProjectId ?? scope.projects[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/site" />}><ArrowLeft className="size-4" aria-hidden /> Site work</Button>
          <h1 className="text-2xl font-semibold tracking-tight">Site photos</h1>
          <p className="text-sm text-muted-foreground">Newest first. Tap a photo to open it full size.</p>
        </div>
        {scope.projects.length > 1 && (
          <form method="get" className="flex items-center gap-2">
            <NativeSelect name="project" defaultValue={projectId ?? ""} aria-label="Project">
              <option value="">All projects</option>
              {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        )}
      </div>

      {uploadTo && hasPermission(user.role, "site:write") && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add photos{scope.projects.length > 1 ? ` to ${scope.projects.find((p) => p.id === uploadTo)?.name}` : ""}</CardTitle></CardHeader>
          <CardContent><PhotoUploader key={uploadTo} projectId={uploadTo} /></CardContent>
        </Card>
      )}

      <PhotoGrid photos={photos} showProject={!projectId && scope.projects.length > 1} />
    </div>
  );
}
