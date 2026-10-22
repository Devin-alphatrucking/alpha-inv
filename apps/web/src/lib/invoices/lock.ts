// Serialises changes to ONE invoice. Two people saving a payment, or confirming a review, at the same moment would otherwise
// both read the same totals and write conflicting results (payments above the total, doubled line items, a wrong status).
// Call it first thing inside the transaction; the lock is released when the transaction ends.
type Queryable = { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };

export async function lockInvoice(tx: Queryable, invoiceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
}
