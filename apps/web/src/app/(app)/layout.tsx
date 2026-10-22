import { pageOrg } from "@/lib/org/page";
import { AppShell } from "@/components/app-shell";
import { FormatProvider } from "@/components/format-provider";
import { PlanBanner } from "@/components/plan-banner";
import { getBrand, getFormat } from "@/lib/brand/brand";
import { listMyCompanies } from "@/lib/flows/account";
import { getEntitlements } from "@/lib/plans/entitlements";
import { getProjectScope } from "@/lib/projects/scope";
import { currentPlatformAdmin } from "@/lib/master/guard";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, user } = await pageOrg();

  const projectScope = await getProjectScope(user);
  const brand = await getBrand();
  const fmt = await getFormat();
  const companies = await listMyCompanies(session.user.id);
  const entitlements = await getEntitlements(user.orgId);
  const isPlatformAdmin = (await currentPlatformAdmin()) !== null;

  return (
    <FormatProvider format={brand.format}>
    <AppShell
      brand={{ name: brand.name, logoUrl: brand.logoUrl }}
      banner={<PlanBanner e={entitlements} isAdmin={session.user.role === "ADMIN"} format={(d) => fmt.date(d)} />}
      companies={companies}
      currentOrgId={user.orgId}
      role={session.user.role}
      name={session.user.name ?? session.user.email ?? "User"}
      email={session.user.email ?? ""}
      projects={projectScope.projects}
      selectedProjectId={projectScope.selectedProjectId}
      isPlatformAdmin={isPlatformAdmin}
    >
      {children}
    </AppShell>
    </FormatProvider>
  );
}
