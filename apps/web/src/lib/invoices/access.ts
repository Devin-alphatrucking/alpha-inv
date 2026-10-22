import { dbFor } from "@/lib/org/scoped-db";
import { AppError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  role: "ADMIN" | "STAFF";
  orgId: string;
};

/** Prisma where clause for invoices visible to the current user. */
export function invoiceAccessWhere(user: SessionUser) {
  if (user.role === "ADMIN") return {};
  return {
    OR: [
      { uploadedById: user.id },
      {
        project: { assignments: { some: { userId: user.id } } },
      },
    ],
  };
}

export async function assertInvoiceAccess(
  invoiceId: string,
  user: SessionUser
) {
  const invoice = await dbFor(user.orgId).invoice.findFirst({
    where: { id: invoiceId, ...invoiceAccessWhere(user) },
  });
  if (!invoice) {
    throw new AppError("NOT_FOUND_001", "Invoice not found or access denied.");
  }
  return invoice;
}

export function isPayableStatus(status: string) {
  return (
    status === "UNPAID" ||
    status === "PAID" ||
    status === "OVERDUE" ||
    status === "PARTIALLY_PAID"
  );
}

export function formatPaidAt(
  date: Date | null | undefined,
  fmt: { dateTimeShort: (d: Date) => string }
) {
  if (!date) return null;
  return fmt.dateTimeShort(date);
}
