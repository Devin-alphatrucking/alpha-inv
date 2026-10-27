"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { recordInvoicePayment } from "./actions";
import { useFormat } from "@/components/format-provider";

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10);
}

export function InvoicePaymentControls({
  invoiceId, status, paidAt, invoiceNumber, vendorName, categoryName,
  total, paidAmount, compact,
}: {
  invoiceId: string;
  status: string;
  paidAt: string | null;
  invoiceNumber: string;
  vendorName: string;
  categoryName: string | null;
  total: number;
  paidAmount: number;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const fmt = useFormat();
  const formatCurrency = (value: number) => fmt.money(value, 2);
  const formatPaidAt = (date: Date) => fmt.dateTimeShort(date);
  const [open, setOpen] = useState(false);
  const balance = Math.max(0, total - paidAmount);
  const [amount, setAmount] = useState((balance || total).toFixed(2));
  const [paidOn, setPaidOn] = useState(today());
  const [mode, setMode] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const canPay = balance > 0.009 &&
    ["UNPAID", "PARTIALLY_PAID", "OVERDUE"].includes(status);

  function submitPayment() {
    startTransition(async () => {
      try {
        await recordInvoicePayment({
          invoiceId, amount: Number(amount), paidOn, mode, reference, notes,
        });
        toast.success("Payment recorded");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Payment failed");
      }
    });
  }

  function handlePrint() {
    const paidLabel = paidAt ? formatPaidAt(new Date(paidAt)) : "—";
    const html = `<!doctype html><html><head><title>Invoice ${escapeHtml(invoiceNumber)}</title><style>body{font-family:system-ui,sans-serif;padding:32px;color:#111}h1{font-size:20px;margin:0 0 8px}p{margin:4px 0;font-size:14px}.muted{color:#666}.box{border:1px solid #ddd;border-radius:12px;padding:20px;max-width:420px}</style></head><body><div class="box"><h1>Invoice ${escapeHtml(invoiceNumber)}</h1><p><span class="muted">Vendor:</span> ${escapeHtml(vendorName)}</p><p><span class="muted">Category:</span> ${escapeHtml(categoryName ?? "—")}</p><p><span class="muted">Total:</span> ${escapeHtml(formatCurrency(total))}</p><p><span class="muted">Paid:</span> ${escapeHtml(formatCurrency(paidAmount))}</p><p><span class="muted">Balance:</span> ${escapeHtml(formatCurrency(balance))}</p><p><span class="muted">Status:</span> ${escapeHtml(status.replaceAll("_", " "))}</p><p><span class="muted">Fully paid at:</span> ${escapeHtml(paidLabel ?? "—")}</p></div><script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!w) return toast.error("Allow pop-ups to print");
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className={compact ? "flex items-center gap-1.5" : "flex flex-col gap-2"}>
      {!compact && paidAmount > 0 && (
        <p className="text-xs text-muted-foreground">
          Paid {formatCurrency(paidAmount)} · Balance {formatCurrency(balance)}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        {canPay && (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              // Every time the dialog opens it starts from the CURRENT balance (a payment saved a moment ago changes it).
              if (next) {
                setAmount((balance || total).toFixed(2));
                setPaidOn(today());
                setReference("");
                setNotes("");
              }
              setOpen(next);
            }}
          >
            <DialogTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                >
                  <CreditCard className="size-3.5" />
                  Pay
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record payment</DialogTitle>
                <DialogDescription>
                  {invoiceNumber} · {vendorName} · Balance {formatCurrency(balance)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`amount-${invoiceId}`}>Amount</Label>
                  <Input
                    id={`amount-${invoiceId}`}
                    type="number"
                    min="0.01"
                    max={balance}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`date-${invoiceId}`}>Payment date</Label>
                  <DatePicker
                    id={`date-${invoiceId}`}
                    value={paidOn}
                    onChange={setPaidOn}
                    placeholder="Select payment date"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`mode-${invoiceId}`}>Mode</Label>
                  <Input
                    id={`mode-${invoiceId}`}
                    list={`modes-${invoiceId}`}
                    placeholder="Bank transfer, UPI, cheque…"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  />
                  <datalist id={`modes-${invoiceId}`}>
                    {["Bank transfer", "NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Card"].map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`ref-${invoiceId}`}>Reference</Label>
                  <Input
                    id={`ref-${invoiceId}`}
                    placeholder="UTR / cheque number"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor={`notes-${invoiceId}`}>Notes</Label>
                  <Input
                    id={`notes-${invoiceId}`}
                    placeholder="Optional payment notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    pending ||
                    !paidOn ||
                    Number(amount) <= 0 ||
                    Number(amount) > balance + 0.01
                  }
                  onClick={submitPayment}
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Save payment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={handlePrint}
          title="Print invoice"
        >
          <Printer className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
