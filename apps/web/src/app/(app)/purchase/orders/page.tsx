import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";
import { listOrders } from "@/lib/flows/purchase";
import { ORDER_LABEL } from "@/lib/purchase/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OrderBadge } from "../badges";

const FILTERS = ["DRAFT", "SENT", "CANCELLED"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "order:view")) redirect("/purchase");
  const params = await searchParams;
  const fmt = await getFormat();
  const scope = await getProjectScope(user);
  const filter = (FILTERS as readonly string[]).includes(params.status ?? "") ? (params.status as (typeof FILTERS)[number]) : null;
  const orders = await listOrders(user, { projectId: scope.selectedProjectId, status: filter ? [filter] : undefined, take: 200 });
  const raiseIn = scope.selectedProjectId ?? scope.projects.find((p) => p.status === "ACTIVE")?.id ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase" />}><ArrowLeft className="size-4" aria-hidden /> Purchase</Button>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">Orders to suppliers, newest first.</p>
        </div>
        {hasPermission(user.role, "order:write") && raiseIn && <Button size="sm" nativeButton={false} render={<Link href={`/purchase/orders/new?project=${raiseIn}`} />}>New order</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter orders">
        <Button size="sm" variant={!filter ? "default" : "outline"} nativeButton={false} render={<Link href="/purchase/orders" />}>All</Button>
        {FILTERS.map((s) => <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} nativeButton={false} render={<Link href={`/purchase/orders?status=${s}`} />}>{ORDER_LABEL[s]}</Button>)}
      </div>

      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No orders here.</p>
          ) : (
            <ul className="divide-y">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/purchase/orders/${o.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{o.number} · {o.vendorName}</span>
                      <span className="flex items-center gap-2"><span className="text-sm font-medium tabular-nums">{fmt.money(o.totalMinor / 100, 2)}</span><OrderBadge status={o.status} /></span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[o.projectName, `ordered ${fmt.date(new Date(`${o.orderDate}T00:00:00Z`))}`, o.deliveryDate ? `deliver by ${fmt.date(new Date(`${o.deliveryDate}T00:00:00Z`))}` : null, o.requestNumber ? `from ${o.requestNumber}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
