"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteInvoicePayment } from "@/app/(app)/invoices/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function PaymentDeleteButton({
  invoiceId,
  paymentId,
}: {
  invoiceId: string;
  paymentId: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteInvoicePayment({ invoiceId, paymentId });
      toast.success("Payment deleted successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
      throw error;
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Delete payment"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete Payment"
        description="Are you sure you want to delete this payment record? This action will adjust the invoice status and balance."
        confirmLabel="Delete Payment"
        onConfirm={handleDelete}
      />
    </>
  );
}
