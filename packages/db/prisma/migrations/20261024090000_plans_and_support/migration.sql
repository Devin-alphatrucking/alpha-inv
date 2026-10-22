-- Phase 4 (docs/PHASE-4-PLANS-AND-SUPPORT.md): plans, subscriptions (quantity = number of project plans) and support tickets.
-- 1. tables  2. Row-Level Security for tickets  3. the default plan  4. a subscription for every existing company

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'WAITING', 'RESOLVED');
-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "interval" TEXT NOT NULL DEFAULT 'MONTH',
    "includedProjects" INTEGER NOT NULL DEFAULT 1,
    "userLimit" INTEGER NOT NULL DEFAULT 5,
    "aiPagesPerProject" INTEGER NOT NULL DEFAULT 500,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "overrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "planCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_createdAt_idx" ON "SupportTicket"("organizationId", "createdAt");
-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");
-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security: a company only ever sees its own tickets (same rule as the other company tables).
-- ---------------------------------------------------------------------------
ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "SupportTicket"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

-- ---------------------------------------------------------------------------
-- The default plan. One copy includes 1 project and 5 users and 500 AI pages per project per month.
-- Price is left empty until it is decided (set it with: UPDATE "Plan" SET "priceMinor" = ... WHERE code = 'PROJECT').
-- ---------------------------------------------------------------------------
INSERT INTO "Plan" ("id", "code", "name", "includedProjects", "userLimit", "aiPagesPerProject", "currency", "interval", "active", "updatedAt")
VALUES ('plan_project', 'PROJECT', 'Project plan', 1, 5, 500, 'INR', 'MONTH', true, now())
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Existing companies keep working: each gets an ACTIVE subscription sized to what it already uses
-- (active projects, and members divided by the users per plan), at least 1. Nobody is locked out by the new limits.
-- ---------------------------------------------------------------------------
INSERT INTO "Subscription" ("id", "organizationId", "planId", "quantity", "status", "provider", "updatedAt")
SELECT 'sub_' || o."id", o."id", 'plan_project',
       GREATEST(
         1,
         (SELECT count(*) FROM "Project" p WHERE p."organizationId" = o."id" AND p."status" = 'ACTIVE')::int,
         CEIL((SELECT count(*) FROM "Membership" m WHERE m."organizationId" = o."id") / 5.0)::int
       ),
       'ACTIVE', 'manual', now()
FROM "Organization" o
ON CONFLICT ("organizationId") DO NOTHING;
