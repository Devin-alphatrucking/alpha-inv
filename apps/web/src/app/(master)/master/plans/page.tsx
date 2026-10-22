import { listPlans } from "@/lib/master/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "../master-client";
import { PageTitle, money } from "../master-ui";
import { editPlanAction } from "../actions";

export const metadata = { title: "Plans | Master console" };
export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const plans = await listPlans();
  return (
    <>
      <PageTitle title="Plans">What each plan costs and includes. A change applies to every company on the plan.</PageTitle>
      {plans.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {p.name} <span className="font-mono text-sm font-normal text-muted-foreground">({p.code})</span>
            </CardTitle>
            <CardDescription>
              {p._count.subscriptions} compan{p._count.subscriptions === 1 ? "y" : "ies"} on this plan ·{" "}
              {p.priceMinor === null ? "price not set (customers cannot buy online)" : `${money(p.priceMinor, p.currency)} per ${p.interval === "YEAR" ? "year" : "month"}`}
              {p.providerPlanId ? ` · Razorpay plan ${p.providerPlanId}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={editPlanAction.bind(null, p.code)}
              submit="Save plan"
              confirmText={`Change ${p.name} for all ${p._count.subscriptions} companies on it? Limits change at once. A new price applies to NEW purchases; people already paying keep the price they agreed to.`}
              fields={[
                { name: "name", label: "Name", defaultValue: p.name },
                { name: "priceMinor", label: "Price in paise (99900 = 999.00)", type: "number", min: 100, defaultValue: p.priceMinor, placeholder: "Not set" },
                { name: "currency", label: "Currency", defaultValue: p.currency },
                { name: "includedProjects", label: "Projects per plan", type: "number", min: 1, defaultValue: p.includedProjects },
                { name: "userLimit", label: "People per plan", type: "number", min: 1, defaultValue: p.userLimit },
                { name: "aiPagesPerProject", label: "AI pages per project per month", type: "number", min: 0, defaultValue: p.aiPagesPerProject },
              ]}
            />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
