import { hasPermission, homeFor } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { getProjectScope } from "@/lib/projects/scope";
import { todayIn } from "@/lib/invoices/status";
import { cashFlow } from "@/lib/invoices/planner";
import { loadOwed } from "@/lib/invoices/planner-load";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PayRun, type PlannerRow } from "./pay-run";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment planner" };

/** What falls due week by week, and a place to pick the bills to pay and record them all at once. Administrators only. */
export default async function PaymentPlannerPage() {
  const { session, db, user } = await pageOrg();
  if (!hasPermission(session.user.role, "payment:plan")) redirect(homeFor(session.user.role));
  const fmt = await getFormat();
  const money = (minor: number) => fmt.money(minor / 100, 2);
  const today = todayIn(fmt.format.timeZone);

  const scope = await getProjectScope(user);
  const owed = await loadOwed(db, scope.selectedProjectId ? { projectId: scope.selectedProjectId } : {}, today);
  const weeks = cashFlow(owed);
  const biggest = Math.max(1, ...weeks.map((w) => w.amountMinor));

  const sum = (pick: (o: (typeof owed)[number]) => boolean) => owed.filter(pick).reduce((s, o) => s + o.balanceMinor, 0);
  const tiles = [
    { label: "Total owed", value: sum(() => true), hint: `${owed.length} bill${owed.length === 1 ? "" : "s"}` },
    { label: "Overdue now", value: sum((o) => o.daysLate !== null && o.daysLate > 0), hint: "pay first", tone: "text-red-600" },
    { label: "Due in 7 days", value: sum((o) => o.daysLate !== null && o.daysLate <= 0 && o.daysLate >= -6), hint: "today and the next 6 days" },
    { label: "Due in 30 days", value: sum((o) => o.daysLate !== null && o.daysLate <= 0 && o.daysLate >= -29), hint: "to have the money ready" },
  ];

  const rows: PlannerRow[] = owed.map((o) => ({
    id: o.id,
    invoiceNumber: o.invoiceNumber,
    vendorName: o.vendorName,
    projectName: o.projectName,
    balanceMinor: o.balanceMinor,
    daysLate: o.daysLate,
    dueLabel: o.dueDate ? fmt.date(o.dueDate) : "no due date",
  }));
  const csvHref = `/api/reports/payables${scope.selectedProjectId ? `?project=${encodeURIComponent(scope.selectedProjectId)}` : ""}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <Link href="/payments" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> Payments
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Payment planner</h1>
            <p className="text-sm text-muted-foreground">
              What you owe, when it falls due, and one place to pay it{scope.selectedProjectId ? " (for the project chosen at the top)" : ""}.
            </p>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={csvHref} download />}>
            <Download className="size-3.5" aria-hidden /> Download the list (CSV)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="gap-1 p-4">
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className={`text-xl tabular-nums ${t.value > 0 ? (t.tone ?? "") : ""}`}>{money(t.value)}</CardTitle>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Money going out, week by week</CardTitle>
          <CardDescription>Each week starts today. Use it to see when you need the cash in the bank.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {weeks.map((w) => (
            <div key={w.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className={w.key === "overdue" && w.amountMinor > 0 ? "font-medium text-red-600" : "text-muted-foreground"}>{w.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${w.label}: ${money(w.amountMinor)} in ${w.count} bill${w.count === 1 ? "" : "s"}`}>
                <div className={`h-full rounded-full ${w.key === "overdue" ? "bg-red-500" : w.key === "none" ? "bg-muted-foreground/50" : "bg-primary"}`} style={{ width: `${(w.amountMinor / biggest) * 100}%` }} />
              </div>
              <span className="w-36 text-right tabular-nums">
                {w.amountMinor > 0 ? money(w.amountMinor) : <span className="text-muted-foreground">-</span>}
                {w.count > 0 && <span className="ml-1.5 text-xs text-muted-foreground">({w.count})</span>}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay run</CardTitle>
          <CardDescription>Tick the bills you are paying (or use a quick pick), change an amount to pay part of a bill, then record them all together.</CardDescription>
        </CardHeader>
        <CardContent>
          <PayRun rows={rows} today={today} />
        </CardContent>
      </Card>
    </div>
  );
}
