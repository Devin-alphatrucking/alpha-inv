-- Phase 12: the Purchase module (material requests, purchase orders).
-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "neededBy" DATE,
    "note" TEXT,
    "requestedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "materialId" TEXT,

    CONSTRAINT "MaterialRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "requestId" TEXT,
    "number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "deliveryAddress" TEXT,
    "paymentTerms" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "materialId" TEXT,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCounter_organizationId_kind_year_key" ON "DocumentCounter"("organizationId", "kind", "year");

-- CreateIndex
CREATE INDEX "MaterialRequest_projectId_status_idx" ON "MaterialRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "MaterialRequest_organizationId_status_idx" ON "MaterialRequest"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_organizationId_number_key" ON "MaterialRequest"("organizationId", "number");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_requestId_idx" ON "MaterialRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_organizationId_idx" ON "MaterialRequestLine"("organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_projectId_status_idx" ON "PurchaseOrder"("projectId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_number_key" ON "PurchaseOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_idx" ON "PurchaseOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_organizationId_idx" ON "PurchaseOrderLine"("organizationId");

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A company only ever sees its own purchase records (same rule as the other company tables).
ALTER TABLE "DocumentCounter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "DocumentCounter" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "MaterialRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "MaterialRequest" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "MaterialRequestLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "MaterialRequestLine" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "PurchaseOrder" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "PurchaseOrderLine" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
