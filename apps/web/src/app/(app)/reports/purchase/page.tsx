import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";
import { loadPurchaseReport } from "@/lib/flows/purchase-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Params = Promise<{ view?: string; project?: string; from?: string; to?: string }>;
const VIEWS = [
  { id: "projects", label: "Projects" },
  { id: "suppliers", label: "Suppliers" },
  { id: "open", label: "Open orders" },
] as const;

export default async function PurchaseReportPage({ searchParams }: { searchParams: Params }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "order:view")) redirect("/dashboard");
  const params = await searchParams;
  const view = (VIEWS.some((v) => v.id === params.view) ? params.view : "projects") as (typeof VIEWS)[number]["id"];
  const scope = await getProjectScope(user);
  const projectId = scope.projects.some((p) => p.id === params.project) ? params.project! : scope.selectedProjectId;
  const report = await loadPurchaseReport(user, { projectId, from: params.from, to: params.to });
  if (!report) redirect("/dashboard");
  const fmt = await getFormat();
  const money = (minor: number) => fmt.money(minor / 100, 0);
  const date = (s: string | null) => (s ? fmt.date(new Date(`${s}T00:00:00Z`)) : "—");
  const t = report.totals;
  const query = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(projectId ? { project: projectId } : {}), from: report.period.from, to: report.period.to, ...extra }).toString()}`;
  const stat = (label: string, value: string, hint: string, warn = false) => (
    <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className={`text-2xl tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</CardTitle></CardHeader><CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent></Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase report</h1>
          <p className="text-sm text-muted-foreground">What was ordered, delivered, billed and paid, and how suppliers delivered{projectId ? `, ${scope.projects.find((p) => p.id === projectId)?.name}` : ", all your projects"}.</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/reports/purchase${query({ view })}`} />}><Download className="size-4" aria-hidden /> Download this view (CSV)</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Ordered", money(t.committedMinor), "orders sent, with GST (closed short: what arrived)")}
        {stat("Still to deliver", money(t.toDeliverMinor), "ordered, not yet on site")}
        {stat("Delivered, not billed", money(t.awaitingBillMinor), "bills still to come from suppliers")}
        {stat("Billed", money(t.billedAllMinor), `paid ${money(t.paidMinor)} · to pay ${money(t.outstandingMinor)}`)}
      </div>

      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="view" value={view} />
            {scope.projects.length > 1 && (
              <label className="grid gap-1 text-xs text-muted-foreground">
                Project
                <NativeSelect name="project" defaultValue={projectId ?? ""}>
                  <option value="">All projects</option>
                  {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              </label>
            )}
            {view === "suppliers" && (
              <>
                <label className="grid gap-1 text-xs text-muted-foreground">Orders from<Input type="date" name="from" defaultValue={report.period.from} max={report.today} className="w-auto" /></label>
                <label className="grid gap-1 text-xs text-muted-foreground">to<Input type="date" name="to" defaultValue={report.period.to} max={report.today} className="w-auto" /></label>
              </>
            )}
            <Button type="submit" size="sm">Show</Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report views">
        {VIEWS.map((v) => (
          <Button key={v.id} size="sm" variant={view === v.id ? "default" : "outline"} role="tab" aria-selected={view === v.id} nativeButton={false} render={<Link href={query({ view: v.id })} />}>{v.label}</Button>
        ))}
      </div>

      {view === "projects" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By project, to date</CardTitle>
            <CardDescription>
              &ldquo;Expected cost&rdquo; is what the project will have cost if everything ordered is billed: bills so far plus what is ordered and not billed yet.
              {report.showBudget ? " It is compared with the budget." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {report.projects.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No orders or bills yet.</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">To deliver</TableHead><TableHead className="text-right">Delivered, not billed</TableHead>
                    <TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">To pay</TableHead><TableHead className="text-right">Expected cost</TableHead>
                    {report.showBudget && <TableHead className="text-right">Budget</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}<span className="block text-xs font-normal text-muted-foreground">{p.orders} {p.orders === 1 ? "order" : "orders"}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.committedMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.toDeliverMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.awaitingBillMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.billedAllMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.paidMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.outstandingMinor)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(p.expectedMinor)}</TableCell>
                      {report.showBudget && (
                        <TableCell className="text-right tabular-nums">
                          {p.budgetMinor === null ? <span className="text-muted-foreground">none</span> : (
                            <span className="inline-flex flex-col items-end gap-1">{money(p.budgetMinor)}<Badge variant={p.budgetStatus === "over" ? "destructive" : p.budgetStatus === "warn" ? "secondary" : "outline"}>{p.budgetStatus === "over" ? "Over budget" : p.budgetStatus === "warn" ? "Near budget" : "Within budget"}</Badge></span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {view === "suppliers" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supplier delivery performance</CardTitle>
            <CardDescription>Orders dated {date(report.period.from)} to {date(report.period.to)}. &ldquo;On time&rdquo; counts fully delivered orders that have a delivery date. &ldquo;Fill&rdquo; is quantity received against ordered; &ldquo;Refused&rdquo; is the share of arrivals that was damaged or wrong.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {report.suppliers.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No orders sent in this period.</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">On time</TableHead><TableHead className="text-right">Average delay</TableHead><TableHead className="text-right">Fill</TableHead><TableHead className="text-right">Refused</TableHead><TableHead className="text-right">Late now</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {report.suppliers.map((s) => (
                    <TableRow key={s.vendorId}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(s.valueMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.onTimePercent === null ? "—" : `${s.onTimePercent}%`}{s.measured > 0 && <span className="block text-xs text-muted-foreground">{s.onTime} of {s.measured}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.averageDelayDays === null ? "—" : `${s.averageDelayDays} days`}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.fillPercent === null ? "—" : `${s.fillPercent}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.refusedPercent === null ? "—" : `${s.refusedPercent}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.lateOpen > 0 ? <span className="font-medium text-destructive">{s.lateOpen}</span> : 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {view === "open" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders waiting for goods</CardTitle>
            <CardDescription>Sent to the supplier and not fully delivered. Late ones first.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {report.open.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing is waiting for delivery.</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Order</TableHead><TableHead>Supplier</TableHead><TableHead>Project</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Still to deliver</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {report.open.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium"><Link href={`/purchase/orders/${o.id}`} className="underline-offset-2 hover:underline">{o.number}</Link></TableCell>
                      <TableCell>{o.vendorName}</TableCell>
                      <TableCell>{o.projectName}</TableCell>
                      <TableCell>{date(o.deliveryDate)}{o.daysLate > 0 && <Badge variant="destructive" className="ml-2">{o.daysLate} {o.daysLate === 1 ? "day" : "days"} late</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.receivedPercent}%</TableCell>
                      <TableCell className="text-right tabular-nums">{money(o.toDeliverMinor)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
