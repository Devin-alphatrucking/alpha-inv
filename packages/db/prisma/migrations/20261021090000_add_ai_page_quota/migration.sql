-- AI page quota, per-project Azure credentials, and file hashing.
-- Additive only: existing rows keep working (projects default to 500 pages/month
-- and fall back to the env-level Azure credentials until a key is saved).

-- AlterTable
ALTER TABLE "Project"
  ADD COLUMN "azureEndpoint" TEXT,
  ADD COLUMN "azureKeyEnc" TEXT,
  ADD COLUMN "azureKeyHint" TEXT,
  ADD COLUMN "monthlyPageLimit" INTEGER NOT NULL DEFAULT 500;

-- AlterTable
ALTER TABLE "Invoice"
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "pageCount" INTEGER;

-- CreateIndex
CREATE INDEX "Invoice_projectId_fileHash_idx" ON "Invoice"("projectId", "fileHash");

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PageUsage" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "pagesUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageUsageEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "invoiceId" TEXT,
    "fileHash" TEXT,
    "period" TEXT NOT NULL,
    "pagesReserved" INTEGER NOT NULL,
    "pagesActual" INTEGER,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageUsage_scopeKey_period_key" ON "PageUsage"("scopeKey", "period");

-- CreateIndex
CREATE INDEX "PageUsageEvent_projectId_createdAt_idx" ON "PageUsageEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PageUsageEvent_userId_createdAt_idx" ON "PageUsageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PageUsageEvent_period_idx" ON "PageUsageEvent"("period");
