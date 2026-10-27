"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createOrderAction, updateOrderAction } from "../actions";
import { blankLine, LineEditor, type EditorLine } from "../line-editor";
import { NativeSelect } from "@/components/ui/native-select";


export type OrderFormValues = { vendorId: string; orderDate: string; deliveryDate: string; deliveryAddress: string; paymentTerms: string; note: string; lines: EditorLine[] };

/** Make a purchase order (or change a draft one): supplier, dates, terms and the items with their rates. */
export function OrderForm({
  projectId, requestId = null, orderId = null, suppliers, initial,
}: {
  projectId: string; requestId?: string | null; orderId?: string | null; suppliers: { id: string; name: string; gstin: string | null }[]; initial: OrderFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<OrderFormValues>({ ...initial, lines: initial.lines.length ? initial.lines : [blankLine()] });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: Exclude<keyof OrderFormValues, "lines">) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const bad = (f: string) => (error?.field === f ? true : undefined);

  function save() {
    setError(null);
    start(async () => {
      const data = { ...v, lines: v.lines.map(({ description, unit, quantity, rate, gstPercent, materialId }) => ({ description, unit, quantity, rate, gstPercent, materialId })) };
      const r = orderId ? await updateOrderAction(orderId, data) : await createOrderAction(projectId, requestId, data);
      if (!r.ok) {
        setError({ field: r.field, message: r.error });
        toast.error(r.error);
        return;
      }
      toast.success(orderId ? "Order updated" : `${"number" in r ? r.number : "Order"} created as a draft`);
      router.push(`/purchase/orders/${orderId ?? ("id" in r ? r.id : "")}`);
      router.refresh();
    });
  }

  return (
    <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="po-vendor">Supplier</Label>
          <NativeSelect id="po-vendor" value={v.vendorId} onChange={set("vendorId")} disabled={pending} aria-invalid={bad("vendorId")}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` (${s.gstin})` : ""}</option>)}
          </NativeSelect>
          {suppliers.length === 0 && <p className="text-xs text-muted-foreground">There are no suppliers yet. Add one under Vendors first.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-date">Order date</Label>
          <Input id="po-date" type="date" value={v.orderDate} onChange={set("orderDate")} disabled={pending} aria-invalid={bad("orderDate")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-delivery">Deliver by</Label>
          <Input id="po-delivery" type="date" value={v.deliveryDate} onChange={set("deliveryDate")} disabled={pending} aria-invalid={bad("deliveryDate")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-terms">Payment terms</Label>
          <Input id="po-terms" value={v.paymentTerms} onChange={set("paymentTerms")} maxLength={220} placeholder="e.g. 30 days from delivery" disabled={pending} aria-invalid={bad("paymentTerms")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-address">Deliver to</Label>
          <Input id="po-address" value={v.deliveryAddress} onChange={set("deliveryAddress")} maxLength={320} placeholder="Site address" disabled={pending} aria-invalid={bad("deliveryAddress")} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Items</Label>
        <LineEditor lines={v.lines} onChange={(lines) => setV((s) => ({ ...s, lines }))} withRates disabled={pending} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="po-note">Note to the supplier (optional)</Label>
        <Textarea id="po-note" rows={3} value={v.note} onChange={set("note")} disabled={pending} aria-invalid={bad("note")} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {orderId ? "Save changes" : "Save as draft"}
        </Button>
      </div>
    </form>
  );
}
