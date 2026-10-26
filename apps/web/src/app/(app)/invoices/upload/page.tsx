import { hasPermission } from "@/lib/roles";
import { seesAllProjects } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isDocumentIntelligenceConfigured } from "@/lib/azure/document-intelligence";
import { isBlobStorageConfigured } from "@/lib/azure/blob";
import { UploadDropzone } from "./upload-dropzone";
import { ClipboardList } from "lucide-react";
import { getProjectScope } from "@/lib/projects/scope";

export default async function UploadInvoicePage() {
  const { session, db, user } = await pageOrg();
  if (!hasPermission(session.user.role, "invoice:upload")) redirect("/invoices");
  const isStaff = !seesAllProjects(session.user.role); // limited to their own projects and uploads
  const blobConfigured = isBlobStorageConfigured();
  const projectScope = await getProjectScope(user);

  // AI is available when the server has env-level credentials, or at least one
  // project the user can use has its own saved Azure key.
  const projectsWithOwnKey = await db.project.count({
    where: {
      id: { in: projectScope.projects.map((p) => p.id) },
      azureKeyEnc: { not: null },
    },
  });
  const diConfigured =
    isDocumentIntelligenceConfigured() || projectsWithOwnKey > 0;

  const [pendingCount, categories] = await Promise.all([
    session?.user.id && isStaff
      ? db.invoice.count({
          where: {
            status: { in: ["NEEDS_REVIEW", "PROCESSING"] },
            OR: [
              { uploadedById: session.user.id },
              {
                project: {
                  assignments: { some: { userId: session.user.id } },
                },
              },
            ],
          },
        })
      : Promise.resolve(0),
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-0 sm:max-w-2xl sm:gap-6">
      <div className="space-y-1.5 sm:space-y-2">
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight sm:text-3xl">
          {isStaff ? "Upload an invoice" : "Upload invoice"}
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
          {isStaff
            ? "Snap or drop a purchase invoice. We’ll extract the fields — then you verify and save."
            : "Upload a scanned or photographed invoice. We extract fields with Azure Document Intelligence, then you verify and save."}
        </p>
      </div>

      {isStaff && pendingCount > 0 && (
        <Link
          href="/invoices"
          className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-3.5 py-3 transition-all duration-200 hover:border-foreground/20 hover:shadow-sm active:scale-[0.99] sm:px-4 sm:py-3.5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-muted p-2.5">
              <ClipboardList className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Pending reviews</p>
              <p className="truncate text-xs text-muted-foreground">
                Finish verifying extracted invoices
              </p>
            </div>
          </div>
          <Badge variant="secondary">{pendingCount}</Badge>
        </Link>
      )}

      <Card className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <CardHeader className="space-y-1.5 px-4 pt-4 pb-2.5 sm:px-6 sm:pt-6 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">New invoice</CardTitle>
          <CardDescription className="text-xs leading-relaxed sm:text-sm">
            PDF, JPG, or PNG — max 20MB
            {!blobConfigured && (
              <>
                {" "}
                · stored locally for now
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          {!diConfigured ? (
            <div className="rounded-2xl border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium">
                Azure Document Intelligence isn&apos;t configured yet
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                An admin needs to add the Azure endpoint and key in the project
                settings (Projects → Edit).
              </p>
            </div>
          ) : (
            <UploadDropzone
              categories={categories}
              projects={projectScope.projects}
              initialProjectId={projectScope.selectedProjectId}
              reviewHref={isStaff ? "/invoices" : "/invoices?status=NEEDS_REVIEW"}
            />
          )}
        </CardContent>
      </Card>

      {isStaff && (
        <div className="flex justify-center pb-4 sm:pb-6">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/invoices" />}
          >
            View my invoices
          </Button>
        </div>
      )}
    </div>
  );
}
