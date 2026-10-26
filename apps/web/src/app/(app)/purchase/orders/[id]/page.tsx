import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getFormat, getBrand } from "@/lib/brand/brand";
import { getOrder, suppliers } from "@/lib/flows/purchase";
import { getDelivery } from "@/lib/flows/delivery";
import { PROGRESS_LABEL } from "@/lib/purchase/delivery-rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrderBadge } from "../../badges";
import { OrderActions } from "../order-actions";
import { OrderForm } from "../order-form";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "order:view")) redirect("/purchase");
  const { id } = await params;
  const order = await getOrder(user, id);
  if (!order) notFound();
  const [fmt, brand] = await Promise.all([getFormat(), getBrand()]);
  const money = (minor: number) => fmt.money(minor / 100, 2);
  const date = (s: string | null) => (s ? fmt.date(new Date(`${s}T00:00:00Z`)) : "—");
  const editing = (await searchParams).edit === "1" && order.actions.includes("edit");
  const delivery = await getDelivery(user, order.id);

  if (editing) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href={`/purchase/orders/${order.id}`} />}><ArrowLeft className="size-4" aria-hidden /> {order.number}</Button>
          <h1 className="text-2xl font-semibold tracking-tight">Change {order.number}</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <OrderForm
              projectId={order.projectId}
              orderId={order.id}
              suppliers={await suppliers(user)}
              initial={{
                vendorId: order.vendorId, orderDate: order.orderDate, deliveryDate: order.deliveryDate ?? "", deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", note: order.note ?? "",
                lines: order.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, rate: l.rate, gstPercent: l.gstPercent, materialId: l.materialId })),
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase/orders" />}><ArrowLeft className="size-4" aria-hidden /> Purchase orders</Button>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{order.number} <OrderBadge status={order.status} /></h1>
        <p className="text-sm text-muted-foreground">
          {order.vendorName} · {order.projectName}
          {order.requestId && <> · from <Link href={`/purchase/requests/${order.requestId}`} className="underline underline-offset-2">{order.requestNumber}</Link></>}
        </p>
      </div>

      {order.status === "CANCELLED" && <Card className="border-destructive/40 print:hidden"><CardContent className="py-4 text-sm"><span className="font-medium">Cancelled:</span> {order.cancelReason}</CardContent></Card>}
      {delivery && order.status === "SENT" && (
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <span><span className="font-medium">Delivery:</span> {PROGRESS_LABEL[delivery.progress].toLowerCase()}{delivery.receipts.length > 0 && ` in ${delivery.receipts.length} ${delivery.receipts.length === 1 ? "delivery" : "deliveries"}`}</span>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/purchase/deliveries/${order.id}`} />}>Open deliveries</Button>
          </CardContent>
        </Card>
      )}
      <div className="print:hidden"><OrderActions orderId={order.id} actions={order.actions} editHref={`/purchase/orders/${order.id}?edit=1`} /></div>

      {/* The order as the supplier sees it: this block is what prints. */}
      <Card className="print:border-0 print:shadow-none print:ring-0">
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Purchase order</p>
              <CardTitle className="text-2xl">{order.number}</CardTitle>
              <p className="mt-1 text-sm">{brand.name}</p>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Order date</dt><dd>{date(order.orderDate)}</dd>
              <dt className="text-muted-foreground">Deliver by</dt><dd>{date(order.deliveryDate)}</dd>
              <dt className="text-muted-foreground">Payment terms</dt><dd>{order.paymentTerms ?? "—"}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{order.status === "CANCELLED" ? "CANCELLED" : order.status === "DRAFT" ? "Draft" : "Issued"}</dd>
            </dl>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Supplier</p>
              <p className="font-medium">{order.vendorName}</p>
              {order.vendorGstin && <p className="text-sm">GSTIN {order.vendorGstin}</p>}
              {order.vendorAddress && <p className="whitespace-pre-wrap text-sm">{order.vendorAddress}</p>}
              {order.vendorContact && <p className="text-sm">{order.vendorContact}</p>}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deliver to</p>
              <p className="font-medium">{order.projectName}</p>
              {order.deliveryAddress && <p className="whitespace-pre-wrap text-sm">{order.deliveryAddress}</p>}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>#</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">GST</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{i + 1}</TableCell><TableCell className="whitespace-normal">{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.quantity}</TableCell><TableCell>{l.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt.money(Number(l.rate), 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.gstPercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.amountMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell colSpan={6} className="text-right">Subtotal</TableCell><TableCell className="text-right tabular-nums">{money(order.subtotalMinor)}</TableCell></TableRow>
              <TableRow><TableCell colSpan={6} className="text-right">GST</TableCell><TableCell className="text-right tabular-nums">{money(order.gstMinor)}</TableCell></TableRow>
              <TableRow><TableCell colSpan={6} className="text-right font-semibold">Total</TableCell><TableCell className="text-right text-base font-semibold tabular-nums">{money(order.totalMinor)}</TableCell></TableRow>
            </TableFooter>
          </Table>
          {order.note && <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">Note:</span> {order.note}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
