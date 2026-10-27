-- Phase 8c: a reference from the phone app on records it can create, so sending the same save twice makes one record.
-- AlterTable
ALTER TABLE "SitePhoto" ADD COLUMN     "clientRef" TEXT;

-- AlterTable
ALTER TABLE "SiteIssue" ADD COLUMN     "clientRef" TEXT;

-- AlterTable
ALTER TABLE "MaterialRequest" ADD COLUMN     "clientRef" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SitePhoto_organizationId_clientRef_key" ON "SitePhoto"("organizationId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "SiteIssue_organizationId_clientRef_key" ON "SiteIssue"("organizationId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_organizationId_clientRef_key" ON "MaterialRequest"("organizationId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_clientRef_key" ON "GoodsReceipt"("organizationId", "clientRef");

