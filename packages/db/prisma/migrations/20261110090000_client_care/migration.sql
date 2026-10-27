-- Phase 17: client care. Notes and follow-up reminders our own team keeps about each company.
-- Platform-only: no company policy exists, so a company user can read nothing here; the master console reads and writes
-- inside a transaction that sets app.platform = 'on'.

CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "task" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    "doneByEmail" TEXT,

    CONSTRAINT "ClientFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientNote_organizationId_createdAt_idx" ON "ClientNote"("organizationId", "createdAt");
CREATE INDEX "ClientFollowUp_doneAt_dueOn_idx" ON "ClientFollowUp"("doneAt", "dueOn");
CREATE INDEX "ClientFollowUp_organizationId_idx" ON "ClientFollowUp"("organizationId");

ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "ClientNote"
  USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');

ALTER TABLE "ClientFollowUp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "ClientFollowUp"
  USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
