import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttentionSummary, BucketKey, Owed } from "@/lib/invoices/ageing";
import type { BudgetAlert } from "@/lib/projects/budget";

const BAR: Record<BucketKey, string> = {
  current: "bg-emerald-500",
  d1_30: "bg-amber-400",
  d31_60: "bg-orange-500",
  d61_90: "bg-red-500",
  d90: "bg-red-800",
  noDue: "bg-muted-foreground/40",
};

type Props = {
  summary: AttentionSummary;
  drafts: number;
  /** Formats an amount in whole paise/cents. */
  money: (minor: number) => string;
  date: (d: Date) => string;
  /** Projects at 80% or more of their budget (administrators only). */
  budgets?: BudgetAlert[];
};

function Row({ o, money, date, late }: { o: Owed; money: (m: number) => string; date: (d: Date) => string; late: boolean }) {
  const when =
    o.daysLate === null ? "" : o.daysLate > 0 ? `${o.daysLate} day${o.daysLate === 1 ? "" : "s"} late` : o.daysLate === 0 ? "due today" : `in ${-o.daysLate} day${o.daysLate === -1 ? "" : "s"}`;
  return (
    <li>
      <Link href={`/invoices/${o.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted">
        <span className="min-w-0">
          <span className="block truncate font-medium">{o.vendorName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {o.invoiceNumber} · {o.projectName}
            {o.dueDate ? ` · due ${date(o.dueDate)}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">{money(o.balanceMinor)}</span>
          <span className={`block text-xs ${late ? "text-red-600" : "text-muted-foreground"}`}>{when}</span>
        </span>
      </Link>
    </li>
  );
}

/** The top of the dashboard: what to do today, and how old the unpaid bills are. */
export function AttentionPanel({ summary, drafts, money, date, budgets = [] }: Props) {
  const nothing = summary.overdue.count === 0 && summary.dueSoon.count === 0 && drafts === 0 && budgets.length === 0;
  const max = Math.max(1, summary.owedMinor);
  const plural = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;

  return (
    <section aria-label="Needs attention" className="grid gap-4">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <Link href="/invoices?status=OVERDUE">
          <Card className={`h-full transition-colors hover:bg-muted/40 ${summary.overdue.count ? "border-red-300 dark:border-red-900" : ""}`}>
            <CardHeader className="gap-1 p-3 sm:p-4">
              <CardDescription className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" aria-hidden /> Overdue
              </CardDescription>
              <CardTitle className={`text-lg tabular-nums sm:text-xl ${summary.overdue.count ? "text-red-600" : ""}`}>{money(summary.overdue.amountMinor)}</CardTitle>
              <p className="text-xs text-muted-foreground">{plural(summary.overdue.count)}</p>
            </CardHeader>
          </Card>
        </Link>
        <Card className="h-full">
          <CardHeader className="gap-1 p-3 sm:p-4">
            <CardDescription className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden /> Due in 7 days
            </CardDescription>
            <CardTitle className="text-lg tabular-nums sm:text-xl">{money(summary.dueSoon.amountMinor)}</CardTitle>
            <p className="text-xs text-muted-foreground">{plural(summary.dueSoon.count)}</p>
          </CardHeader>
        </Card>
        <Link href="/invoices?status=NEEDS_REVIEW">
          <Card className={`h-full transition-colors hover:bg-muted/40 ${drafts ? "border-amber-300 dark:border-amber-900" : ""}`}>
            <CardHeader className="gap-1 p-3 sm:p-4">
              <CardDescription className="flex items-center gap-1.5">
                <ClipboardCheck className="size-3.5" aria-hidden /> Waiting for review
              </CardDescription>
              <CardTitle className="text-lg tabular-nums sm:text-xl">{drafts}</CardTitle>
              <p className="text-xs text-muted-foreground">read by the AI, not confirmed yet</p>
            </CardHeader>
          </Card>
        </Link>
        <Card className="h-full">
          <CardHeader className="gap-1 p-3 sm:p-4">
            <CardDescription className="flex items-center gap-1.5">
              <Wallet className="size-3.5" aria-hidden /> Total still to pay
            </CardDescription>
            <CardTitle className="text-lg tabular-nums sm:text-xl">{money(summary.owedMinor)}</CardTitle>
            <p className="text-xs text-muted-foreground">across all confirmed invoices</p>
          </CardHeader>
        </Card>
      </div>

      {nothing ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing needs attention right now: no overdue invoices, nothing due this week, and nothing waiting for review.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Most overdue</CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {summary.overdue.oldest.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">Nothing is overdue.</p>
              ) : (
                <ul className="grid">
                  {summary.overdue.oldest.map((o) => (
                    <Row key={o.id} o={o} money={money} date={date} late />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Due soon</CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {summary.dueSoon.items.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">Nothing is due in the next 7 days.</p>
              ) : (
                <ul className="grid">
                  {summary.dueSoon.items.map((o) => (
                    <Row key={o.id} o={o} money={money} date={date} late={false} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {budgets.length > 0 && (
        <Card className={budgets.some((b) => b.level === "over") ? "border-red-300 dark:border-red-900" : "border-amber-300 dark:border-amber-900"}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Budget alerts</CardTitle>
            <CardDescription>Projects that have used 80% or more of their budget.</CardDescription>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <ul className="grid">
              {budgets.map((b) => (
                <li key={b.projectId}>
                  <Link href={`/projects/${b.projectId}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {money(b.spentMinor)} of {money(b.budgetMinor)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${b.level === "over" ? "text-red-600" : "text-amber-600"}`}>
                      {Math.round(b.percent)}% {b.level === "over" ? "(over)" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {summary.owedMinor > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">How old is what you owe</CardTitle>
            <CardDescription>Unpaid balance by how long past its due date.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-1">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Unpaid balance by age">
              {summary.buckets
                .filter((b) => b.amountMinor > 0)
                .map((b) => (
                  <div key={b.key} className={BAR[b.key]} style={{ width: `${(b.amountMinor / max) * 100}%` }} title={`${b.label}: ${money(b.amountMinor)}`} />
                ))}
            </div>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {summary.buckets
                .filter((b) => b.count > 0)
                .map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${BAR[b.key]}`} aria-hidden />
                      {b.label} <span className="text-xs text-muted-foreground">({b.count})</span>
                    </span>
                    <span className="font-medium tabular-nums">{money(b.amountMinor)}</span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
