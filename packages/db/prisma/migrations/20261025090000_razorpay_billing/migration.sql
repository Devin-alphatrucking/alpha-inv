-- Razorpay billing: purchases (one provider subscription per project plan), payments, webhook inbox.
-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "providerPlanAmount" INTEGER,
ADD COLUMN     "providerPlanId" TEXT;
-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billing" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "extraQuantity" INTEGER NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "BillingPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "providerSubscriptionId" TEXT NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "currentStart" TIMESTAMP(3),
    "currentEnd" TIMESTAMP(3),
    "chargeAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "cancelAtCycleEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "shortUrl" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPurchase_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "BillingPurchase_providerSubscriptionId_key" ON "BillingPurchase"("providerSubscriptionId");
-- CreateIndex
CREATE INDEX "BillingPurchase_organizationId_status_idx" ON "BillingPurchase"("organizationId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_providerPaymentId_key" ON "BillingPayment"("providerPaymentId");
-- CreateIndex
CREATE INDEX "BillingPayment_organizationId_paidAt_idx" ON "BillingPayment"("organizationId", "paidAt");
-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_eventId_key" ON "BillingEvent"("eventId");
-- CreateIndex
CREATE INDEX "BillingEvent_receivedAt_idx" ON "BillingEvent"("receivedAt");
-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_idx" ON "BillingEvent"("organizationId");
-- AddForeignKey
ALTER TABLE "BillingPurchase" ADD CONSTRAINT "BillingPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BillingPurchase" ADD CONSTRAINT "BillingPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "BillingPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
