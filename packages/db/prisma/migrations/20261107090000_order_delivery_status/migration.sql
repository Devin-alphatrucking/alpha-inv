-- Phase 12b: an order moves through part delivered, delivered and closed as goods arrive.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PART_DELIVERED' BEFORE 'CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED' BEFORE 'CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CLOSED' BEFORE 'CANCELLED';

ALTER TABLE "PurchaseOrder" ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closeReason" TEXT;
