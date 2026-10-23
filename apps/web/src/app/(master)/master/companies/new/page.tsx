import Link from "next/link";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { COUNTRY_DEFAULTS } from "@/lib/org/starter-data";
import { trialDays } from "@/lib/plans/entitlements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "../../master-ui";
import { ActionForm } from "../../master-client";
import { createCompanyAction } from "../../actions";

export const metadata = { title: "New company | Master console" };
export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await pagePlatformAdmin();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title="Set up a company by hand">For a partner, a sales deal, or anyone who cannot use the sign-up form.</PageTitle>
        <Link href="/master/companies" className="text-sm underline-offset-4 hover:underline">
          All companies
        </Link>
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">The company and its first administrator</CardTitle>
          <CardDescription>
            The administrator is emailed a link (valid for 7 days) to choose their own password, which also confirms their address. You never see or set it. An address that already has an account is refused.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createCompanyAction}
            submit="Create company"
            reasonLabel="Reason (kept in the audit log)"
            fields={[
              { name: "companyName", label: "Company name", required: true, placeholder: "For example: Sanvicasa Builders" },
              { name: "country", label: "Country", type: "select", required: true, defaultValue: "IN", options: Object.entries(COUNTRY_DEFAULTS).map(([value, c]) => ({ value, label: c.label })), hint: "Sets the currency and time zone." },
              { name: "adminName", label: "Administrator's name", required: true },
              { name: "adminEmail", label: "Administrator's email", type: "email", required: true },
              {
                name: "mode",
                label: "Plan",
                type: "select",
                required: true,
                defaultValue: "trial",
                options: [
                  { value: "trial", label: "Free trial" },
                  { value: "managed", label: "Managed by hand (active, no payment)" },
                ],
              },
              { name: "days", label: "Trial days (for a free trial)", type: "number", min: 1, max: 365, defaultValue: trialDays() },
              { name: "quantity", label: "Project plans (for managed by hand)", type: "number", min: 1, max: 1000, defaultValue: 1, hint: "Each plan covers one project." },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
