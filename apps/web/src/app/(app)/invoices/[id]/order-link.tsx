"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { linkInvoiceAction } from "../../purchase/actions";

/** Link this bill to one of the supplier's sent orders, or take the link off. */
export function OrderLink({ invoiceId, linkedOrderId, candidates }: { invoiceId: string; linkedOrderId: string | null; candidates: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, orderId: string | null) {
    setBusy(key);
    const r = await linkInvoiceAction(invoiceId, orderId);
    setBusy(null);
    if (r.ok) toast.success(orderId ? "Linked to the order" : "Link removed");
    else toast.error(r.error);
    router.refresh();
  }

  if (linkedOrderId) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={busy !== null} onClick={() => void run("unlink", null)}>
        {busy === "unlink" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Unlink className="size-4" aria-hidden />} Remove the link
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {candidates.map((c) => (
        <Button key={c.id} type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(c.id, c.id)}>
          {busy === c.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />} {c.label}
        </Button>
      ))}
    </div>
  );
}
