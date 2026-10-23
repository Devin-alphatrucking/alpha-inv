-- Daily email digest: per-person switch and a once-a-day marker per company.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailDigest" BOOLEAN NOT NULL DEFAULT true;
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "digestSentOn" TEXT;
