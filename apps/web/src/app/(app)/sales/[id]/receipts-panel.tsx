"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useConfirm } from "@/components/confirm-provider";
import { useFormat } from "@/components/format-provider";
import { deleteReceiptAction, recordReceiptAction } from "../actions";

type Receipt = { id: string; amount: number; receivedOn: string; mode: string | null; reference: string | null };
const MODES = ["UPI", "NEFT", "RTGS", "IMPS", "Cheque", "Cash", "Card"];

/** Money received against the invoice: the list, a form to add the next payment (starts as the whole balance), and removal. */
export function ReceiptsPanel({ invoiceId, receipts, balance, today, canWrite, cancelled }: { invoiceId: string; receipts: Receipt[]; balance: number; today: string; canWrite: boolean; cancelled: boolean }) {
  const router = useRouter();
  const fmt = useFormat();
  const ask = useConfirm();
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  const [receivedOn, setReceivedOn] = useState(today);
  const [mode, setMode] = useState("UPI");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        const r = await recordReceiptAction(invoiceId, { amount: Number(amount), receivedOn, mode, reference });
        if (r.ok) {
          toast.success("Payment recorded");
          setReference("");
          setAmount(r.balance > 0 ? String(r.balance) : "");
          router.refresh();
        } else setError({ message: r.error, field: r.field });
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  async function remove(r: Receipt) {
    const ok = await ask({ title: "Remove this payment?", description: `${fmt.money(r.amount, 2)} received on ${r.receivedOn} will be removed and the balance goes back up.`, confirmLabel: "Remove", variant: "destructive" });
    if (!ok) return;
    start(async () => {
      try {
        const res = await deleteReceiptAction(r.id);
        if (res.ok) {
          toast.success("Payment removed");
          router.refresh();
        } else toast.error(res.error);
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Payments received</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{fmt.money(r.amount, 2)}</p>
                  <p className="text-xs text-muted-foreground">{r.receivedOn}{r.mode ? ` · ${r.mode}` : ""}{r.reference ? ` · ${r.reference}` : ""}</p>
                </div>
                {canWrite && (
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove this payment" disabled={pending} onClick={() => remove(r)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && !cancelled && balance > 0 && (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-4" noValidate>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-amount">Amount received</Label>
              <Input id="rc-amount" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
              {error?.field === "amount" && <p className="text-xs text-destructive">{error.message}</p>}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-date">Received on</Label>
              <Input id="rc-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
              {error?.field === "receivedOn" && <p className="text-xs text-destructive">{error.message}</p>}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-mode">How</Label>
              <NativeSelect id="rc-mode" value={mode} className="w-full" onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-ref">Reference</Label>
              <Input id="rc-ref" value={reference} maxLength={100} placeholder="UTR or cheque no." onChange={(e) => setReference(e.target.value)} />
            </div>
            {error && !error.field && <p className="text-sm text-destructive sm:col-span-4">{error.message}</p>}
            <div className="sm:col-span-4">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Record payment
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
