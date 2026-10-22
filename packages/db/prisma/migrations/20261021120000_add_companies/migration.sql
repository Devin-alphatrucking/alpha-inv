-- Step 2a of docs/PHASE-2-COMPANIES.md: companies + memberships, nullable
-- organizationId columns, and a backfill of all existing data into one
-- default company. Additive only: nothing reads the new columns yet.


-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ProjectAssignment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ProjectNote" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ApiErrorLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PageUsageEvent" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'TRIAL',
    "country" TEXT NOT NULL DEFAULT 'IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "displayName" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "supportEmail" TEXT,
    "supportUrl" TEXT,
    "appModel" TEXT NOT NULL DEFAULT 'A',

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_organizationId_idx" ON "ProjectAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "ProjectNote_organizationId_idx" ON "ProjectNote"("organizationId");

-- CreateIndex
CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");

-- CreateIndex
CREATE INDEX "Material_organizationId_idx" ON "Material"("organizationId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_idx" ON "Vendor"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_organizationId_idx" ON "InvoiceLineItem"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_idx" ON "ActivityLog"("organizationId");

-- CreateIndex
CREATE INDEX "ApiErrorLog_organizationId_idx" ON "ApiErrorLog"("organizationId");

-- CreateIndex
CREATE INDEX "PageUsageEvent_organizationId_idx" ON "PageUsageEvent"("organizationId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill (safe to re-run)
-- ---------------------------------------------------------------------------

-- Only when there is existing single-company data to move: a brand-new install gets
-- no company here (the seed script or the sign-up flow creates the first one).
INSERT INTO "Organization" ("id", "name", "slug", "status", "displayName", "updatedAt")
SELECT 'org_default', 'Sanvicasa', 'sanvicasa', 'ACTIVE', 'Sanvicasa', now()
WHERE EXISTS (SELECT 1 FROM "User")
   OR EXISTS (SELECT 1 FROM "Project")
   OR EXISTS (SELECT 1 FROM "Invoice")
   OR EXISTS (SELECT 1 FROM "Category")
   OR EXISTS (SELECT 1 FROM "Vendor")
ON CONFLICT ("id") DO NOTHING;

-- Every existing user becomes a member of the default company (no-op when it was not created) with their current role.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role")
SELECT 'mem_' || u."id", u."id", 'org_default', u."role" FROM "User" u
ON CONFLICT ("userId", "organizationId") DO NOTHING;

-- Core records
UPDATE "Project"  SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Category" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Material" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Vendor"   SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "Invoice"  SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;

-- Child rows take their parent's company
UPDATE "InvoiceLineItem" c SET "organizationId" = p."organizationId"
  FROM "Invoice" p WHERE c."invoiceId" = p."id" AND c."organizationId" IS NULL;
UPDATE "Payment" c SET "organizationId" = p."organizationId"
  FROM "Invoice" p WHERE c."invoiceId" = p."id" AND c."organizationId" IS NULL;
UPDATE "AuditLog" c SET "organizationId" = p."organizationId"
  FROM "Invoice" p WHERE c."invoiceId" = p."id" AND c."organizationId" IS NULL;
UPDATE "ProjectNote" c SET "organizationId" = p."organizationId"
  FROM "Project" p WHERE c."projectId" = p."id" AND c."organizationId" IS NULL;
UPDATE "ProjectAssignment" c SET "organizationId" = p."organizationId"
  FROM "Project" p WHERE c."projectId" = p."id" AND c."organizationId" IS NULL;

-- History and usage tables (single company so far)
UPDATE "ActivityLog"    SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "ApiErrorLog"    SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
UPDATE "PageUsageEvent" SET "organizationId" = 'org_default' WHERE "organizationId" IS NULL;
