-- Step 2e: company logo storage (see docs/PHASE-2-COMPANIES.md).
-- CreateTable
CREATE TABLE "OrganizationLogo" (
    "organizationId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationLogo_pkey" PRIMARY KEY ("organizationId")
);
-- AddForeignKey
ALTER TABLE "OrganizationLogo" ADD CONSTRAINT "OrganizationLogo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
