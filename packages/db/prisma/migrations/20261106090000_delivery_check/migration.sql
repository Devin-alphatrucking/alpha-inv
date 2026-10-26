-- Phase 14: delivery check (goods received against a purchase order) and linking an invoice to its order.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "SitePhoto" ADD COLUMN     "receiptId" TEXT;

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "challanNo" TEXT,
    "note" TEXT,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rejected" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "remark" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsReceipt_orderId_idx" ON "GoodsReceipt"("orderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_idx" ON "GoodsReceipt"("organizationId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_orderLineId_idx" ON "GoodsReceiptLine"("orderLineId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_organizationId_idx" ON "GoodsReceiptLine"("organizationId");

-- CreateIndex
CREATE INDEX "SitePhoto_receiptId_idx" ON "SitePhoto"("receiptId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A company only ever sees its own delivery records.
ALTER TABLE "GoodsReceipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "GoodsReceipt" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "GoodsReceiptLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "GoodsReceiptLine" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
