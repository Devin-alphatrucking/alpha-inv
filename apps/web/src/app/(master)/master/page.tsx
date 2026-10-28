import Link from "next/link";
import { overview, listCompanies, openFollowUps } from "@/lib/master/queries";
import { STAGES, STAGE_LABEL, dueTone, todayUtc } from "@/lib/master/health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DueBadge, HealthLabel, PageTitle, Stat, StageBadge, STATE_LABEL, fmtDate, money } from "./master-ui";
import type { PlanState } from "@/lib/plans/rules";

export const dynamic = "force-dynamic";

const MODULES: { key: string; label: string }[] = [
  { key: "INVOICE", label: "Accounts: invoices" },
  { key: "PAYMENT", label: "Accounts: payments" },
  { key: "PURCHASE", label: "Purchase" },
  { key: "SITE", label: "Site work" },
  { key: "VENDOR", label: "Vendors" },
];

const shortDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

export default async function MasterOverview() {
  const [o, overdue, followUps] = await Promise.all([overview(), listCompanies({ state: "past_due", page: 1 }), openFollowUps(6)]);
  const today = todayUtc();
  const mrr = Object.entries(o.mrr);
  const paid = Object.entries(o.paidLast30);
  const order: PlanState[] = ["active", "trial", "past_due_grace", "past_due", "canceling", "canceled", "trial_expired", "none"];
  const maxWeek = Math.max(1, ...o.signupsByWeek.map((w) => w.count));
  const maxUse = Math.max(1, o.companies, ...MODULES.map((m) => o.moduleUse[m.key] ?? 0));
  const signups12 = o.signupsByWeek.reduce((s, w) => s + w.count, 0);

  return (
    <>
      <PageTitle title="Overview">How the business is doing: clients, money and what needs us. Times are UTC.</PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Companies" value={o.companies} hint={`${o.newThisWeek} new this week`} href="/master/companies" />
        <Stat label="Active this week" value={o.activeThisWeek} hint={o.companies ? `${Math.round((o.activeThisWeek / o.companies) * 100)}% of companies` : undefined} href="/master/companies?stage=using" />
        <Stat label="On trial" value={o.trialsRunning} hint={`${o.trialsEnding.length} ending within 7 days`} tone={o.trialsEnding.length ? "warn" : undefined} href="/master/companies?state=trial" />
        <Stat label="Paying" value={o.payingPlans} hint={mrr.length ? mrr.map(([c, v]) => `${money(v, c)} a month`).join(", ") : "No recurring revenue yet"} href="/master/billing" />
        <Stat label="Needs attention" value={o.needAttention} hint="Overdue, trial ending or ended" tone={o.needAttention ? "warn" : undefined} href="/master/companies?attention=1" />
        <Stat label="Open tickets" value={o.openTickets} hint={`${o.errors24h} errors in 24 hours`} tone={o.openTickets ? "warn" : undefined} href="/master/tickets?status=ACTIVE" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New companies by week</CardTitle>
            <CardDescription>{signups12} in the last 12 weeks. Each bar is one week, the last is this week.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex h-36 items-end gap-1.5" aria-label="New companies by week">
              {o.signupsByWeek.map((w) => (
                <li key={w.weekStart.toISOString()} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center" title={`Week of ${shortDate(w.weekStart)}: ${w.count}`}>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{w.count || ""}</span>
                  <span className="block min-h-px rounded-t bg-primary/80" style={{ height: `${(w.count / maxWeek) * 100}%` }} />
                  <span className="truncate text-[10px] text-muted-foreground">{shortDate(w.weekStart)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What clients use</CardTitle>
            <CardDescription>Companies that did something in each part of the product in the last 30 days, out of {o.companies}.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {MODULES.map((m) => {
              const n = o.moduleUse[m.key] ?? 0;
              return (
                <div key={m.key} className="grid gap-1">
                  <div className="flex justify-between text-sm">
                    <span>{m.label}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                    <div className="h-full rounded-full bg-primary/80" style={{ width: `${(n / maxUse) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention now</CardTitle>
            <CardDescription>
              <Link href="/master/companies?attention=1" className="underline-offset-4 hover:underline">See all {o.needAttention}</Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {o.attentionList.length === 0 && <p className="text-muted-foreground">Nothing urgent.</p>}
            {o.attentionList.map((c) => (
              <Link key={c.id} href={`/master/companies/${c.id}`} className="grid gap-0.5 rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <HealthLabel level={c.level} />
                </span>
                <span className="text-xs text-muted-foreground">{c.reasons.filter((r) => r.severity === "high").map((r) => r.text).join(" · ")}</span>
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
            {followUps.length === 0 && <p className="text-muted-foreground">Nothing planned. Open a company and add one.</p>}
            {followUps.map((f) => (
              <Link key={f.id} href={`/master/companies/${f.organization.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="min-w-0 truncate"><span className="font-medium">{f.organization.name}</span> <span className="text-muted-foreground">{f.task}</span></span>
                <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{fmtDate(f.dueOn)}</span><DueBadge tone={dueTone(f.dueOn, today)} /></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

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
            <CardTitle className="text-base">Newest companies</CardTitle>
            <CardDescription>
              {paid.length ? `Paid in the last 30 days: ${paid.map(([c, v]) => money(v, c)).join(", ")}.` : "No payments in the last 30 days."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {o.recentSignups.length === 0 && <p className="text-muted-foreground">No companies yet.</p>}
            {o.recentSignups.map((c) => (
              <Link key={c.id} href={`/master/companies/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted">
                <span className="min-w-0 truncate"><span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span></span>
                <StageBadge stage={c.stage} />
              </Link>
            ))}
          </CardContent>
        </Card>
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

      {overdue.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment overdue past the grace period</CardTitle>
            <CardDescription>Adding projects, people and invoices is paused for these companies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {overdue.rows.map((c) => (
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
