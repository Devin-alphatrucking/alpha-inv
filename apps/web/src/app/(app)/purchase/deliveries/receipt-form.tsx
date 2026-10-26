"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recordReceiptAction } from "../actions";

type Line = { id: string; description: string; unit: string; ordered: string; received: string; remaining: string };

/** Record one delivery: for each item, how much arrived in good condition and how much was refused. Items that did not come are left blank. */
export function ReceiptForm({ orderId, today, lines }: { orderId: string; today: string; lines: Line[] }) {
  const router = useRouter();
  const [receivedOn, setReceivedOn] = useState(today);
  const [challanNo, setChallanNo] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, { quantity: string; rejected: string; remark: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const get = (id: string) => qty[id] ?? { quantity: "", rejected: "", remark: "" };
  const set = (id: string, k: "quantity" | "rejected" | "remark", v: string) => setQty((s) => ({ ...s, [id]: { ...get(id), [k]: v } }));

  function save() {
    setError(null);
    start(async () => {
      const r = await recordReceiptAction(orderId, { receivedOn, challanNo, note, lines: lines.map((l) => ({ orderLineId: l.id, ...get(l.id) })) });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success("Delivery recorded");
      setQty({});
      setChallanNo("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="rc-date">Arrived on</Label>
          <Input id="rc-date" type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} disabled={pending} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rc-challan">Challan or delivery note number</Label>
          <Input id="rc-challan" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} maxLength={70} placeholder="From the supplier’s paper" disabled={pending} />
        </div>
      </div>
      <div className="grid gap-3">
        {lines.map((l) => (
          <div key={l.id} className="grid gap-2 rounded-xl border bg-muted/30 p-3">
            <p className="text-sm font-medium">{l.description}</p>
            <p className="text-xs text-muted-foreground">Ordered {l.ordered} {l.unit} · received so far {l.received} · still to come {l.remaining}</p>
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" value={get(l.id).quantity} onChange={(e) => set(l.id, "quantity", e.target.value)} placeholder={`Arrived OK (${l.unit})`} aria-label={`Quantity received for ${l.description}`} disabled={pending} />
              <Input inputMode="decimal" value={get(l.id).rejected} onChange={(e) => set(l.id, "rejected", e.target.value)} placeholder="Refused (damaged, wrong)" aria-label={`Quantity refused for ${l.description}`} disabled={pending} />
            </div>
            <Input value={get(l.id).remark} onChange={(e) => set(l.id, "remark", e.target.value)} maxLength={220} placeholder="Remark (optional)" aria-label={`Remark for ${l.description}`} disabled={pending} />
          </div>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rc-note">Note (optional)</Label>
        <Textarea id="rc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="Vehicle number, who unloaded, anything unusual." />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />} Record delivery
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">After saving, add photos of the challan and the goods to the delivery below.</p>
      </div>
    </form>
  );
}
