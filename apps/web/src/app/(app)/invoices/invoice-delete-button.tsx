"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteInvoice } from "@/app/(app)/invoices/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

type InvoiceDeleteButtonProps = {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  variant?: "icon" | "button";
  redirectTo?: string;
  className?: string;
};

export function InvoiceDeleteButton({
  invoiceId,
  invoiceNumber,
  vendorName,
  variant = "icon",
  redirectTo,
  className,
}: InvoiceDeleteButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    try {
      const res = await deleteInvoice(invoiceId);
      if (res && "ok" in res && res.ok) {
        toast.success(`Invoice #${invoiceNumber} deleted`);
        router.refresh();
        if (redirectTo) {
          router.push(redirectTo);
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete invoice"
      );
    }
  };

  return (
    <>
      {variant === "button" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className ?? "gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
          Delete invoice
        </Button>
      ) : (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete invoice ${invoiceNumber}`}
          className={className ?? "text-muted-foreground hover:text-destructive"}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete Invoice #${invoiceNumber}?`}
        description={`Are you sure you want to delete invoice #${invoiceNumber} from ${vendorName}? This will permanently remove the invoice, line items, and payment history.`}
        confirmLabel="Delete Invoice"
        onConfirm={handleDelete}
      />
    </>
  );
}
