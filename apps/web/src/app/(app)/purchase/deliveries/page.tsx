import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getFormat } from "@/lib/brand/brand";
import { listDeliveries } from "@/lib/flows/delivery";
import { PROGRESS_LABEL } from "@/lib/purchase/delivery-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "delivery:view")) redirect("/purchase");
  const all = (await searchParams).all === "1";
  const fmt = await getFormat();
  const rows = await listDeliveries(user, { includeComplete: all });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase" />}><ArrowLeft className="size-4" aria-hidden /> Purchase</Button>
          <h1 className="text-2xl font-semibold tracking-tight">Deliveries</h1>
          <p className="text-sm text-muted-foreground">Orders sent to suppliers. Open one to record what arrived on site.</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={all ? "/purchase/deliveries" : "/purchase/deliveries?all=1"} />}>{all ? "Only waiting" : "Show fully received too"}</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{all ? "No orders have been sent yet." : "Nothing is waiting for delivery."}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.orderId}>
                  <Link href={`/purchase/deliveries/${r.orderId}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.number} · {r.vendorName}</span>
                      <span className="flex items-center gap-1.5">
                        {r.late && <Badge variant="destructive">Late</Badge>}
                        <Badge variant={r.progress === "RECEIVED" ? "default" : r.progress === "PARTLY" ? "secondary" : "outline"}>{PROGRESS_LABEL[r.progress]}</Badge>
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{[r.projectName, r.deliveryDate ? `due ${fmt.date(new Date(`${r.deliveryDate}T00:00:00Z`))}` : "no delivery date"].join(" · ")}</span>
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
