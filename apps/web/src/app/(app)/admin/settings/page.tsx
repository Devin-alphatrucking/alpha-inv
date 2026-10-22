import { redirect } from "next/navigation";
import { rawDb } from "@/lib/db";
import { pageOrg } from "@/lib/org/page";
import { Database, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetDataPanel } from "./reset-data-panel";
import { ExportDataButton } from "@/components/export-data-button";
import { getUsageSummary } from "@/lib/usage/pages";
import { PageLimitPanel } from "./page-limit-panel";
import { BrandingPanel } from "./branding-panel";
import { getRlsStatus } from "@/lib/org/rls-status";

export default async function SettingsPage() {
  const { session, db, orgId } = await pageOrg();
  if (session.user.role !== "ADMIN") redirect("/invoices/upload");

  const projectIds = (await db.project.findMany({ select: { id: true } })).map((p) => p.id);
  const usage = await getUsageSummary(orgId, projectIds);
  const rls = await getRlsStatus().catch(() => null);
  const company = await rawDb.organization.findUniqueOrThrow({ where: { id: orgId } });

  const [projects, invoices, payments, users] = await Promise.all([
    db.project.count(),
    db.invoice.count(),
    db.payment.count(),
    rawDb.membership.count({ where: { organizationId: orgId } }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <Settings className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Application information and administrative data controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="size-4" />
            Stored data
          </CardTitle>
          <CardDescription>Current records across the application.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Projects", projects],
              ["Invoices", invoices],
              ["Payments", payments],
              ["Users", users],
            ].map(([label, count]) => (
              <div key={label} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{count}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding and region</CardTitle>
          <CardDescription>
            How your company looks to your team: name, logo and colours, plus currency and timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingPanel
            initial={{
              companyName: company.name,
              displayName: company.displayName ?? "",
              logoUrl: company.logoUrl,
              primaryColor: company.primaryColor ?? "",
              accentColor: company.accentColor ?? "",
              supportEmail: company.supportEmail ?? "",
              supportUrl: company.supportUrl ?? "",
              country: company.country,
              currency: company.currency,
              timezone: company.timezone,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data isolation</CardTitle>
          <CardDescription>
            Each company only sees its own data. The application enforces this, and the database enforces it again with Row-Level Security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {rls === null ? (
            <p className="text-muted-foreground">Could not check the database protection status.</p>
          ) : rls.active ? (
            <p className="font-medium text-emerald-600">
              Database protection is active ({rls.tablesProtected} tables, connected as {rls.role}).
            </p>
          ) : (
            <p className="font-medium text-amber-600">
              Database protection is NOT active for this connection: {rls.problem}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI page limits</CardTitle>
          <CardDescription>
            Azure Document Intelligence pages per month. Deleted invoices still count.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PageLimitPanel
            initialLimit={usage.companyLimit}
            used={usage.companyUsed}
            period={usage.period}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data exports</CardTitle>
          <CardDescription>Download the complete database or an individual module. Password hashes are never exported.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <ExportDataButton label="Full database Excel" />
            <ExportDataButton label="Full JSON backup" format="json" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[
              ["projects", "Projects"], ["invoices", "Invoices"], ["payments", "Payments"],
              ["vendors", "Vendors"], ["categories", "Categories"], ["materials", "Rate sheet"],
              ["users", "Users"], ["activity-logs", "Activity logs"], ["error-logs", "Error logs"],
            ].map(([dataset, label]) => (
              <ExportDataButton key={dataset} dataset={dataset} label={label} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          <CardDescription>Destructive actions require password verification and explicit confirmation.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetDataPanel />
        </CardContent>
      </Card>
    </div>
  );
}
