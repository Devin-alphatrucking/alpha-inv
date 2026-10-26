"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShoppingCart, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RequestAction } from "@/lib/purchase/rules";
import { cancelRequestAction, decideRequestAction, submitRequestAction, withdrawRequestAction } from "../actions";

/** The steps this person can take on a request. Rejecting asks for a reason first. */
export function RequestActions({ requestId, projectId, actions }: { requestId: string; projectId: string; actions: RequestAction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) {
      toast.success(done);
      setAsking(null);
      setNote("");
    } else toast.error(r.error ?? "That did not work.");
    router.refresh();
  }

  if (actions.length === 0) return null;
  const has = (a: RequestAction) => actions.includes(a);
  const spin = (k: string) => busy === k && <Loader2 className="size-4 animate-spin" aria-hidden />;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {has("submit") && <Button size="sm" disabled={busy !== null} onClick={() => void run("submit", () => submitRequestAction(requestId), "Sent for approval")}>{spin("submit")} Send for approval</Button>}
        {has("withdraw") && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("withdraw", () => withdrawRequestAction(requestId), "Taken back to a draft")}>{spin("withdraw") || <Undo2 className="size-4" aria-hidden />} Take it back to edit</Button>}
        {has("approve") && <Button size="sm" disabled={busy !== null} onClick={() => setAsking(asking === "approve" ? null : "approve")}><Check className="size-4" aria-hidden /> Approve</Button>}
        {has("reject") && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setAsking(asking === "reject" ? null : "reject")}><X className="size-4" aria-hidden /> Reject</Button>}
        {has("order") && <Button size="sm" nativeButton={false} render={<Link href={`/purchase/orders/new?project=${projectId}&request=${requestId}`} />}><ShoppingCart className="size-4" aria-hidden /> Make a purchase order</Button>}
        {has("cancel") && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy !== null} onClick={() => { if (window.confirm("Cancel this request? It cannot be undone.")) void run("cancel", () => cancelRequestAction(requestId), "Request cancelled"); }}>
            {spin("cancel")} Cancel request
          </Button>
        )}
      </div>
      {asking && (
        <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} aria-label={asking === "reject" ? "Why it is rejected" : "Note (optional)"} placeholder={asking === "reject" ? "Why is it rejected? The engineer will read this." : "Note for the purchase officer (optional)"} />
          <div>
            <Button size="sm" disabled={busy !== null} onClick={() => void run("decide", () => decideRequestAction(requestId, asking === "approve", note), asking === "approve" ? "Approved" : "Rejected")}>
              {spin("decide")} {asking === "approve" ? "Confirm approval" : "Confirm rejection"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
