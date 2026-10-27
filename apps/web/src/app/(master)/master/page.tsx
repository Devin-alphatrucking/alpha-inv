import Link from "next/link";
import { overview, listCompanies, openFollowUps } from "@/lib/master/queries";
import { STAGES, STAGE_LABEL, dueTone, todayUtc } from "@/lib/master/health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DueBadge, PageTitle, Stat, STATE_LABEL, fmtDate, money } from "./master-ui";
import type { PlanState } from "@/lib/plans/rules";

export const dynamic = "force-dynamic";

export default async function MasterOverview() {
  const [o, atRisk, followUps] = await Promise.all([overview(), listCompanies({ state: "past_due", page: 1 }), openFollowUps(8)]);
  const today = todayUtc();
  const mrr = Object.entries(o.mrr);
  const order: PlanState[] = ["active", "trial", "past_due_grace", "past_due", "canceling", "canceled", "trial_expired", "none"];

  return (
    <>
      <PageTitle title="Overview">Every company on the platform, at a glance. Times are UTC.</PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies" value={o.companies} hint={`${o.newThisWeek} new this week`} href="/master/companies" />
        <Stat label="Paying plans" value={o.payingPlans} hint={mrr.length ? mrr.map(([c, v]) => `${money(v, c)} per month`).join(", ") : "No recurring revenue yet"} href="/master/billing" />
        <Stat label="Needs attention" value={o.needAttention} hint="At risk: overdue, trial ending or ended" tone={o.needAttention ? "warn" : undefined} href="/master/companies?attention=1" />
        <Stat label="Open tickets" value={o.openTickets} hint={`${o.errors24h} errors in 24 hours`} tone={o.openTickets ? "warn" : undefined} href="/master/tickets?status=ACTIVE" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client funnel</CardTitle>
          <CardDescription>From sign-up to paying. Select a stage to list those companies.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STAGES.map((st) => (
            <Link key={st} href={`/master/companies?stage=${st}`} className="rounded-lg border px-3 py-2 transition-colors hover:bg-muted">
              <p className="text-xl font-semibold tabular-nums">{o.stages[st]}</p>
              <p className="text-sm font-medium">{STAGE_LABEL[st].label}</p>
              <p className="text-xs text-muted-foreground">{STAGE_LABEL[st].hint}</p>
            </Link>
          ))}
        </CardContent>
      </Card>

      {(o.trialsEnding.length > 0 || followUps.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trials ending within 7 days</CardTitle>
              <CardDescription>Worth a call or message before they end.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {o.trialsEnding.length === 0 && <p className="text-muted-foreground">None.</p>}
              {o.trialsEnding.map((c) => (
                <Link key={c.id} href={`/master/companies/${c.id}`} className="flex justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.trialDaysLeft === 0 ? "ends today" : `${c.trialDaysLeft} day${c.trialDaysLeft === 1 ? "" : "s"} left`}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next follow-ups</CardTitle>
              <CardDescription>
                <Link href="/master/follow-ups" className="underline-offset-4 hover:underline">All follow-ups</Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {followUps.length === 0 && <p className="text-muted-foreground">Nothing planned.</p>}
              {followUps.map((f) => (
                <Link key={f.id} href={`/master/companies/${f.organization.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted">
                  <span className="min-w-0 truncate"><span className="font-medium">{f.organization.name}</span> <span className="text-muted-foreground">{f.task}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{fmtDate(f.dueOn)}</span><DueBadge tone={dueTone(f.dueOn, today)} /></span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

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
