import Link from "next/link";
import { overview, listCompanies } from "@/lib/master/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle, Stat, STATE_LABEL, money } from "./master-ui";
import type { PlanState } from "@/lib/plans/rules";

export const dynamic = "force-dynamic";

export default async function MasterOverview() {
  const [o, atRisk] = await Promise.all([overview(), listCompanies({ state: "past_due", page: 1 })]);
  const mrr = Object.entries(o.mrr);
  const order: PlanState[] = ["active", "trial", "past_due_grace", "past_due", "canceling", "canceled", "trial_expired", "none"];

  return (
    <>
      <PageTitle title="Overview">Every company on the platform, at a glance. Times are UTC.</PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies" value={o.companies} hint={`${o.newThisWeek} new this week`} href="/master/companies" />
        <Stat label="Paying plans" value={o.payingPlans} hint={mrr.length ? mrr.map(([c, v]) => `${money(v, c)} per month`).join(", ") : "No recurring revenue yet"} href="/master/billing" />
        <Stat label="Needs attention" value={o.atRisk} hint="Overdue or trial ended" tone={o.atRisk ? "warn" : undefined} href="/master/billing" />
        <Stat label="Open tickets" value={o.openTickets} hint={`${o.errors24h} errors in 24 hours`} tone={o.openTickets ? "warn" : undefined} href="/master/tickets?status=ACTIVE" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Companies by plan state</CardTitle>
          <CardDescription>Select a state to list those companies.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {order
            .filter((s) => o.counts[s])
            .map((s) => (
              <Link key={s} href={`/master/companies?state=${s}`} className="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted">
                <span className="font-semibold tabular-nums">{o.counts[s]}</span> <span className="text-muted-foreground">{STATE_LABEL[s].label}</span>
              </Link>
            ))}
          {o.companies === 0 && <p className="text-sm text-muted-foreground">No companies yet.</p>}
        </CardContent>
      </Card>

      {atRisk.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment overdue past the grace period</CardTitle>
            <CardDescription>Adding projects, people and invoices is paused for these companies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {atRisk.rows.map((c) => (
              <Link key={c.id} href={`/master/companies/${c.id}`} className="flex justify-between rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">{c.quantity} plan{c.quantity === 1 ? "" : "s"}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
