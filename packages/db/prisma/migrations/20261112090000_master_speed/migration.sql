-- Master console speed.
--
-- 1. "When was this company last active" is kept on the company itself (updated by the activity log, at most every 5
--    minutes), so the console's lists no longer have to search the whole log for it.
ALTER TABLE "Organization" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

UPDATE "Organization" o
SET "lastActiveAt" = (SELECT max(a."createdAt") FROM "ActivityLog" a WHERE a."organizationId" = o.id AND a.module <> 'MASTER');

-- 2. One company's newest log rows (its recent activity, what it did lately) come straight from an index ordered by
--    company then time. The old single-column index is redundant with it.
CREATE INDEX "ActivityLog_organizationId_createdAt_idx" ON "ActivityLog"("organizationId", "createdAt" DESC);
DROP INDEX IF EXISTS "ActivityLog_organizationId_idx";
