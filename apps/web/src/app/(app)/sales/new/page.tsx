import Link from "next/link";
import { pageOrg } from "@/lib/org/page";
import { getProfile, listCustomers } from "@/lib/flows/sales";
import { companyToday } from "@/lib/flows/site";
import { hasPermission } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InvoiceForm } from "./invoice-form";

export const metadata = { title: "New sales invoice" };

export default async function NewSalesInvoicePage() {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "sales:write")) return <p className="text-sm text-muted-foreground">You can view sales invoices but not issue them.</p>;
  const [profile, customers, today] = await Promise.all([getProfile(user.orgId), listCustomers(user), companyToday(user.orgId)]);
  if (!profile) {
    return (
      <Card className="border-amber-500/50">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Add your company details first, so they print on the invoice and the right tax is worked out.</p>
          <Button nativeButton={false} render={<Link href="/sales/settings" />}>Add company details</Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New sales invoice</h1>
        <p className="text-sm text-muted-foreground">The tax is worked out from your state ({profile.stateCode}) and the place of supply.</p>
      </div>
      <InvoiceForm
        sellerState={profile.stateCode}
        today={today}
        customers={customers.ok ? customers.customers.map((c) => ({ id: c.id, name: c.name, stateCode: c.stateCode })) : []}
      />
    </div>
  );
}
