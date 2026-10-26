-- Phase 13: the Technical module (site reports, photos, issues).
-- CreateEnum
CREATE TYPE "SiteReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FIXED', 'CLOSED');

-- CreateTable
CREATE TABLE "SiteReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "weather" TEXT,
    "workDone" TEXT NOT NULL,
    "labourCount" INTEGER,
    "machinery" TEXT,
    "materialsUsed" TEXT,
    "problems" TEXT,
    "safetyNote" TEXT,
    "status" "SiteReportStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportId" TEXT,
    "issueId" TEXT,
    "takenOn" DATE NOT NULL,
    "caption" TEXT,
    "area" TEXT,
    "fileUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "area" TEXT,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "raisedById" TEXT,
    "dueDate" DATE,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteReport_projectId_reportDate_key" ON "SiteReport"("projectId", "reportDate");
CREATE INDEX "SiteReport_organizationId_reportDate_idx" ON "SiteReport"("organizationId", "reportDate");
CREATE INDEX "SitePhoto_projectId_takenOn_idx" ON "SitePhoto"("projectId", "takenOn");
CREATE INDEX "SitePhoto_organizationId_idx" ON "SitePhoto"("organizationId");
CREATE INDEX "SitePhoto_reportId_idx" ON "SitePhoto"("reportId");
CREATE INDEX "SitePhoto_issueId_idx" ON "SitePhoto"("issueId");
CREATE INDEX "SiteIssue_projectId_status_idx" ON "SiteIssue"("projectId", "status");
CREATE INDEX "SiteIssue_organizationId_status_idx" ON "SiteIssue"("organizationId", "status");
CREATE INDEX "SiteIssue_assigneeId_idx" ON "SiteIssue"("assigneeId");

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SiteReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "SiteIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A company only ever sees its own site records (same rule as the other company tables).
ALTER TABLE "SiteReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "SiteReport" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "SitePhoto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "SitePhoto" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "SiteIssue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "SiteIssue" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
