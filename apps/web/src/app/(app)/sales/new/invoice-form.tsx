"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/components/format-provider";
import { GST_STATE_LIST } from "@/lib/gst/gstin";
import { GST_RATES, computeInvoice, amountInWords } from "@/lib/sales/rules";
import { createInvoiceAction } from "../actions";
import { CustomerForm } from "../customers/customer-form";

type Customer = { id: string; name: string; stateCode: string | null };
type Row = { description: string; hsnSac: string; quantity: string; unit: string; rate: string; discountPercent: string; gstPercent: string };
const blank = (): Row => ({ description: "", hsnSac: "", quantity: "1", unit: "Nos", rate: "", discountPercent: "0", gstPercent: "18" });
const n = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));

export function InvoiceForm({ sellerState, today, customers }: { sellerState: string; today: string; customers: Customer[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const [customerId, setCustomerId] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(customers.length === 0);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  const customer = customers.find((c) => c.id === customerId);
  const place = placeOfSupply || customer?.stateCode || "";
  const setRow = (i: number, k: keyof Row, value: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: value } : x)));

  // The same rules the server uses, so what is shown here is what will be saved.
  const preview = useMemo(() => {
    if (!place) return null;
    return computeInvoice({
      sellerState,
      placeOfSupply: place,
      lines: rows.map((r) => ({ description: r.description || "item", hsnSac: r.hsnSac || null, quantity: n(r.quantity), unit: r.unit || "Nos", rate: n(r.rate), discountPercent: n(r.discountPercent) || 0, gstPercent: n(r.gstPercent) })),
    });
  }, [rows, place, sellerState]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        const r = await createInvoiceAction({
          customerId,
          invoiceDate,
          dueDate: dueDate || null,
          placeOfSupply: place || undefined,
          notes,
          lines: rows.map((x) => ({ description: x.description, hsnSac: x.hsnSac.trim() || null, quantity: n(x.quantity), unit: x.unit, rate: n(x.rate), discountPercent: n(x.discountPercent) || 0, gstPercent: n(x.gstPercent) })),
        });
        if (r.ok) {
          toast.success(`Invoice ${r.number} issued`);
          router.push(`/sales/${r.id}`);
        } else setError({ message: r.error, field: r.field });
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  const err = (f: string) => (error?.field === f ? <p className="text-xs text-destructive">{error!.message}</p> : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer and dates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="si-customer">Customer</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCustomer((v) => !v)}>
                <UserPlus className="size-4" /> {addingCustomer ? "Close" : "New customer"}
              </Button>
            </div>
            <NativeSelect id="si-customer" value={customerId} className="w-full" onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose the customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
            {err("customerId")}
          </div>
          {addingCustomer && (
            <div className="rounded-xl border bg-muted/30 p-4 sm:col-span-2">
              <CustomerForm
                embedded
                onCreated={(id) => {
                  setCustomerId(id);
                  setAddingCustomer(false);
                  router.refresh();
                }}
              />
            </div>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="si-date">Invoice date</Label>
            <Input id="si-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            {err("invoiceDate")}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="si-due">Due date (optional)</Label>
            <Input id="si-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {err("dueDate")}
          </div>
          <div className="grid content-start gap-1.5 sm:col-span-2">
            <Label htmlFor="si-place">Place of supply</Label>
            <NativeSelect id="si-place" value={place} className="w-full" onChange={(e) => setPlaceOfSupply(e.target.value)}>
              <option value="">Choose the state</option>
              {GST_STATE_LIST.map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {place ? (place === sellerState ? "Same state as you: CGST + SGST." : "Another state: IGST.") : "Starts as the customer's state."}
            </p>
            {err("placeOfSupply")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-3 rounded-xl border p-3.5 sm:grid-cols-6">
              <div className="grid content-start gap-1.5 sm:col-span-4">
                <Label htmlFor={`si-d-${i}`}>Item {i + 1}</Label>
                <Input id={`si-d-${i}`} value={r.description} maxLength={200} placeholder="What was sold" onChange={(e) => setRow(i, "description", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5 sm:col-span-2">
                <Label htmlFor={`si-h-${i}`}>HSN / SAC</Label>
                <Input id={`si-h-${i}`} value={r.hsnSac} inputMode="numeric" maxLength={8} placeholder="e.g. 2523" onChange={(e) => setRow(i, "hsnSac", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`si-q-${i}`}>Quantity</Label>
                <Input id={`si-q-${i}`} value={r.quantity} inputMode="decimal" onChange={(e) => setRow(i, "quantity", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`si-u-${i}`}>Unit</Label>
                <Input id={`si-u-${i}`} value={r.unit} maxLength={12} onChange={(e) => setRow(i, "unit", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`si-r-${i}`}>Rate</Label>
                <Input id={`si-r-${i}`} value={r.rate} inputMode="decimal" onChange={(e) => setRow(i, "rate", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`si-x-${i}`}>Discount %</Label>
                <Input id={`si-x-${i}`} value={r.discountPercent} inputMode="decimal" onChange={(e) => setRow(i, "discountPercent", e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`si-g-${i}`}>GST %</Label>
                <NativeSelect id={`si-g-${i}`} value={r.gstPercent} className="w-full" onChange={(e) => setRow(i, "gstPercent", e.target.value)}>
                  {GST_RATES.map((g) => (
                    <option key={g} value={String(g)}>{g}%</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-end justify-between gap-2">
                <p className="pb-2.5 text-sm font-medium">
                  {preview && preview.ok && preview.lines[i] ? fmt.money(preview.lines[i].lineTotal, 2) : ""}
                </p>
                {rows.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" onClick={() => setRows((x) => [...x, blank()])} disabled={rows.length >= 200}>
              <Plus className="size-4" /> Add an item
            </Button>
          </div>
          {error?.field === "lines" && <p className="text-sm text-destructive">{error.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Total</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {preview && preview.ok ? (
            <div className="grid gap-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span>{fmt.money(preview.taxable, 2)}</span></div>
              {preview.supply === "intra" ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{fmt.money(preview.cgst, 2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{fmt.money(preview.sgst, 2)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{fmt.money(preview.igst, 2)}</span></div>
              )}
              {preview.roundOff !== 0 && <div className="flex justify-between"><span className="text-muted-foreground">Round off</span><span>{fmt.money(preview.roundOff, 2)}</span></div>}
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Invoice total</span><span>{fmt.money(preview.total, 2)}</span></div>
              <p className="text-xs text-muted-foreground">{amountInWords(preview.total)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{place ? (preview && !preview.ok ? preview.error : "") : "Choose the customer or the place of supply to see the tax."}</p>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="si-notes">Note on the invoice (optional)</Label>
            <Textarea id="si-notes" value={notes} rows={2} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && !error.field && <p className="text-sm text-destructive">{error.message}</p>}
          {error && error.field === "profile" && <p className="text-sm text-destructive">{error.message}</p>}
          <div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Issue invoice
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
