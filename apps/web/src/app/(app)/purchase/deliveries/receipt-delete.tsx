"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteReceiptAction } from "../actions";

export function ReceiptDelete({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm("Remove this delivery record? The quantities will no longer count as received.")) return;
    setBusy(true);
    const r = await deleteReceiptAction(receiptId);
    setBusy(false);
    if (r.ok) toast.success("Delivery removed");
    else toast.error(r.error);
    router.refresh();
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => void remove()}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} Remove
    </Button>
  );
}
