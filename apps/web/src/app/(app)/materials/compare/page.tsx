import { hasPermission, homeFor } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { getProjectScope } from "@/lib/projects/scope";
import { todayIn } from "@/lib/invoices/status";
import { comparePrices, parseMonths, PERIOD_CHOICES, sinceDate, MIN_PREMIUM_PERCENT } from "@/lib/invoices/price-compare";
import { loadPurchaseLines } from "@/lib/invoices/price-compare-load";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Price comparison" };

type Props = { searchParams: Promise<{ months?: string }> };

/** The same item bought from different suppliers: who is cheapest, and what buying it all there would have saved. Administrators only. */
export default async function PriceComparePage({ searchParams }: Props) {
  const { session, db, user } = await pageOrg();
  if (!hasPermission(session.user.role, "price:compare")) redirect(homeFor(session.user.role));
  const sp = await searchParams;
  const fmt = await getFormat();
  const money = (n: number) => fmt.money(n, 2);

  const months = parseMonths(sp.months);
  const today = todayIn(fmt.format.timeZone);
  const since = sinceDate(today, months);
  const scope = await getProjectScope(user);
  const { lines, capped } = await loadPurchaseLines(db, { since, projectId: scope.selectedProjectId });
  const items = comparePrices(lines);
  const saving = items.reduce((s, i) => s + i.potentialSaving, 0);
  const csvParams = new URLSearchParams({ months: String(months) });
  if (scope.selectedProjectId) csvParams.set("project", scope.selectedProjectId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <Link href="/materials" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> Rate Sheet
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Price comparison</h1>
            <p className="text-sm text-muted-foreground">
              Items you bought from more than one supplier since {fmt.date(new Date(`${since}T00:00:00Z`))}{scope.selectedProjectId ? " (for the project chosen at the top)" : ""}, before GST.
            </p>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/reports/price-compare?${csvParams.toString()}`} download />}>
            <Download className="size-3.5" aria-hidden /> CSV
          </Button>
        </div>
        <nav className="mt-3 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Period">
          <span className="text-xs text-muted-foreground">Look back:</span>
          {PERIOD_CHOICES.map((m) => (
            <Link key={m} href={`/materials/compare?months=${m}`} aria-current={m === months ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${m === months ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {m} months
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="gap-1 p-4">
            <CardDescription>Could have saved</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">{money(saving)}</CardTitle>
            <p className="text-xs text-muted-foreground">if each item below had all been bought at its cheapest supplier&apos;s average rate</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1 p-4">
            <CardDescription>Items worth a look</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{items.length}</CardTitle>
            <p className="text-xs text-muted-foreground">bought from 2+ suppliers with {MIN_PREMIUM_PERCENT}% or more between them</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1 p-4">
            <CardDescription>Purchase lines read</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{lines.length.toLocaleString("en-IN")}</CardTitle>
            <p className="text-xs text-muted-foreground">{capped ? "the newest 20,000 only" : "from confirmed invoices"}</p>
          </CardHeader>
        </Card>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No item was bought from two suppliers at prices {MIN_PREMIUM_PERCENT}% or more apart in this period. Items are matched by their description and unit exactly as written on the invoice, so a different spelling is a different item.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4" aria-label="Items bought from more than one supplier">
          {items.map((item) => (
            <li key={item.key}>
              <Card>
                <CardHeader className="gap-1 pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {item.description} <span className="text-sm font-normal text-muted-foreground">per {item.unit.toLowerCase()}</span>
                    </CardTitle>
                    <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400">
                      could save {money(item.potentialSaving)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-1.5">
                  {item.suppliers.map((s) => (
                    <div key={s.vendorId} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[1fr_8rem_9rem_7rem]">
                      <span className="min-w-0 truncate font-medium">
                        <Link href={`/vendors/${s.vendorId}`} className="underline-offset-4 hover:underline">{s.vendorName}</Link>
                        {s.vendorId === item.cheapestId && <Badge className="ml-2" variant="secondary">cheapest</Badge>}
                      </span>
                      <span className="text-right font-semibold tabular-nums sm:text-right">
                        {money(s.avgRate)}
                        <span className="block text-xs font-normal text-muted-foreground">average</span>
                      </span>
                      <span className="text-xs text-muted-foreground sm:text-right">
                        {s.quantity.toLocaleString("en-IN")} bought in {s.purchases} purchase{s.purchases === 1 ? "" : "s"}
                        <span className="block">last {money(s.lastRate)} on {fmt.date(new Date(`${s.lastDate}T00:00:00Z`))}</span>
                      </span>
                      <span className={`text-right text-xs ${s.premiumPercent > 0 ? "font-medium text-amber-600" : "text-muted-foreground"}`}>
                        {s.premiumPercent > 0 ? `${s.premiumPercent.toFixed(1)}% above` : "lowest"}
                        {s.extraPaid > 0 && <span className="block">paid {money(s.extraPaid)} extra</span>}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        A difference in price is not always a better deal: quality, brand, delivery and credit terms can explain it, and prices move over time (the &ldquo;last&rdquo; rate shows the most recent). Use this as a starting point for a conversation with your suppliers.
      </p>
    </div>
  );
}
