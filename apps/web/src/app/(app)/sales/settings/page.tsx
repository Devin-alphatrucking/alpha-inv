import { pageOrg } from "@/lib/org/page";
import { getProfile } from "@/lib/flows/sales";
import { hasPermission } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Sales settings" };

export default async function SalesSettingsPage() {
  const { user } = await pageOrg();
  const profile = await getProfile(user.orgId);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales settings</h1>
        <p className="text-sm text-muted-foreground">Your details as they print on every tax invoice. Invoices already issued keep what was printed on them.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company details</CardTitle>
          <CardDescription>Your state decides the tax: a customer in the same state pays CGST + SGST, in another state IGST.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm initial={profile} canEdit={hasPermission(user.role, "sales:write")} />
        </CardContent>
      </Card>
    </div>
  );
}
