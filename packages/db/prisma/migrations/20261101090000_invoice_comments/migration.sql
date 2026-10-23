-- Comments on invoices.
-- CreateTable
CREATE TABLE "InvoiceComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceComment_invoiceId_createdAt_idx" ON "InvoiceComment"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceComment_organizationId_idx" ON "InvoiceComment"("organizationId");

-- AddForeignKey
ALTER TABLE "InvoiceComment" ADD CONSTRAINT "InvoiceComment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceComment" ADD CONSTRAINT "InvoiceComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A company only ever sees its own comments (same rule as the other company tables).
ALTER TABLE "InvoiceComment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "InvoiceComment"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
