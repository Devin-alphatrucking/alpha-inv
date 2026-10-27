"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { OrderAction } from "@/lib/purchase/rules";
import { cancelOrderAction, closeOrderAction, sendOrderAction } from "../actions";
import { useConfirm } from "@/components/confirm-provider";

/** Steps on one purchase order: change a draft, mark it sent, print it, cancel it (with a reason). */
export function OrderActions({ orderId, actions, editHref, shortClose = false }: { orderId: string; actions: OrderAction[]; editHref: string; shortClose?: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const has = (a: OrderAction) => actions.includes(a);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) {
      toast.success(done);
      setCancelling(false);
      setClosing(false);
      setReason("");
    } else toast.error(r.error ?? "That did not work.");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {has("edit") && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={editHref} />}><Pencil className="size-4" aria-hidden /> Change</Button>}
        {has("send") && (
          <Button size="sm" disabled={busy !== null} onClick={async () => { if (await ask({ title: "Mark this order as sent?", description: "It can no longer be edited, only cancelled.", confirmLabel: "Mark as sent", variant: "default" })) void run("send", () => sendOrderAction(orderId), "Marked as sent"); }}>
            {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />} Mark as sent
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print or save as PDF</Button>
        {has("cancel") && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy !== null} onClick={() => setCancelling(!cancelling)}>Cancel order</Button>}
        {has("close") && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setClosing(!closing)}>Close order</Button>}
      </div>
      {closing && (
        <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">{shortClose ? "Not everything arrived. Closing means the rest is not coming." : "Everything arrived. Closing finishes the order."}</p>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={320} aria-label="Why it is closed" placeholder={shortClose ? "Why is the rest not coming? (required)" : "Note (optional)"} />
          <div>
            <Button size="sm" disabled={busy !== null} onClick={() => void run("close", () => closeOrderAction(orderId, reason), "Order closed")}>
              {busy === "close" && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirm close
            </Button>
          </div>
        </div>
      )}
      {cancelling && (
        <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={320} aria-label="Why it is cancelled" placeholder="Why is this order cancelled?" />
          <div>
            <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void run("cancel", () => cancelOrderAction(orderId, reason), "Order cancelled")}>
              {busy === "cancel" && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirm cancellation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
