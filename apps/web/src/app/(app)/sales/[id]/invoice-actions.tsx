"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { cancelInvoiceAction } from "../actions";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" /> Print or save as PDF
    </Button>
  );
}

export function CancelButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();

  async function cancel() {
    const ok = await ask({
      title: `Cancel invoice ${number}?`,
      description: "The invoice stays in your list marked Cancelled and is left out of your totals and downloads. Its number is never used again.",
      confirmLabel: "Cancel invoice",
      cancelLabel: "Keep it",
      variant: "destructive",
    });
    if (!ok) return;
    start(async () => {
      try {
        const r = await cancelInvoiceAction(id);
        if (r.ok) {
          toast.success("Invoice cancelled");
          router.refresh();
        } else toast.error(r.error);
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <Button type="button" variant="destructive" disabled={pending} onClick={cancel}>
      <XCircle className="size-4" /> Cancel invoice
    </Button>
  );
}
