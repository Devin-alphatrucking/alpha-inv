import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getFormat } from "@/lib/brand/brand";
import { getDelivery, companyTodayFor } from "@/lib/flows/delivery";
import { listPhotos } from "@/lib/flows/site";
import { PROGRESS_LABEL } from "@/lib/purchase/delivery-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PhotoGrid } from "../../../site/photo-grid";
import { PhotoUploader } from "../../../site/photo-uploader";
import { ReceiptDelete } from "../receipt-delete";
import { ReceiptForm } from "../receipt-form";

export default async function DeliveryPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "delivery:view")) redirect("/purchase");
  const { orderId } = await params;
  const d = await getDelivery(user, orderId);
  if (!d) notFound();
  const fmt = await getFormat();
  const date = (s: string | null) => (s ? fmt.date(new Date(`${s}T00:00:00Z`)) : "—");
  const today = await companyTodayFor(user.orgId);
  const photos = await Promise.all(d.receipts.map((r) => listPhotos(user, { receiptId: r.id, take: 30 })));
  const canPhoto = hasPermission(user.role, "delivery:write");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase/deliveries" />}><ArrowLeft className="size-4" aria-hidden /> Deliveries</Button>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{d.number} <Badge variant={d.progress === "RECEIVED" ? "default" : d.progress === "PARTLY" ? "secondary" : "outline"}>{PROGRESS_LABEL[d.progress]}</Badge></h1>
        <p className="text-sm text-muted-foreground">{d.vendorName} · {d.projectName}{d.deliveryDate && ` · due ${date(d.deliveryDate)}`}</p>
        {(d.status === "DRAFT" || d.status === "CANCELLED" || d.status === "CLOSED") && <p className="mt-1 text-sm text-destructive">This order is {d.status === "CANCELLED" ? "cancelled" : d.status === "CLOSED" ? "closed" : "still a draft, not sent to the supplier"}, so deliveries cannot be recorded.</p>}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ordered and received</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Refused</TableHead><TableHead className="text-right">To come</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-normal">{l.description} <span className="text-muted-foreground">({l.unit})</span></TableCell>
                  <TableCell className="text-right tabular-nums">{l.ordered}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.received}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.rejected}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.progress === "OVER" ? <span className="font-medium text-destructive">Over by {Number(l.received) - Number(l.ordered)}</span> : l.remaining}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {d.canRecord && (
        <Card>
          <CardHeader><CardTitle className="text-base">Record a delivery</CardTitle></CardHeader>
          <CardContent><ReceiptForm orderId={d.orderId} today={today} lines={d.lines} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Deliveries recorded ({d.receipts.length})</CardTitle></CardHeader>
        <CardContent className="grid gap-5">
          {d.receipts.length === 0 && <p className="text-sm text-muted-foreground">Nothing has arrived yet.</p>}
          {d.receipts.map((r, i) => (
            <section key={r.id} className="grid gap-3 rounded-xl border p-3" aria-label={`Delivery of ${date(r.receivedOn)}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{date(r.receivedOn)}{r.challanNo && ` · challan ${r.challanNo}`}</p>
                  <p className="text-xs text-muted-foreground">recorded by {r.receivedByName ?? "a former member"}</p>
                </div>
                {r.canDelete && <ReceiptDelete receiptId={r.id} />}
              </div>
              <ul className="grid gap-1 text-sm">
                {r.lines.map((l, j) => (
                  <li key={j}>{l.description}: <span className="font-medium tabular-nums">{l.quantity} {l.unit}</span>{Number(l.rejected) > 0 && <span className="text-destructive"> · {l.rejected} refused</span>}{l.remark && <span className="text-muted-foreground"> · {l.remark}</span>}</li>
                ))}
              </ul>
              {r.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}
              {canPhoto && <PhotoUploader projectId={d.projectId} receiptId={r.id} label="Add photos of the challan or goods" />}
              {photos[i].length > 0 && <PhotoGrid photos={photos[i]} />}
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
