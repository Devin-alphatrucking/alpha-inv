-- Phase 6: platform operators and the read access the master console needs.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- The master console reads across companies. It does so ONLY inside a transaction that sets app.platform = 'on'
-- (src/lib/master/db.ts), and only where listed here. Policies are additive to the company-isolation ones: the
-- normal app never sets this, so a company still sees nothing but its own rows.
--   SupportTicket: read + change status;  ActivityLog, ApiErrorLog, Project: read only.
CREATE POLICY platform_read ON "SupportTicket" FOR SELECT USING (current_setting('app.platform', true) = 'on');
CREATE POLICY platform_update ON "SupportTicket" FOR UPDATE
  USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
CREATE POLICY platform_read ON "ActivityLog" FOR SELECT USING (current_setting('app.platform', true) = 'on');
CREATE POLICY platform_read ON "ApiErrorLog" FOR SELECT USING (current_setting('app.platform', true) = 'on');
CREATE POLICY platform_read ON "Project" FOR SELECT USING (current_setting('app.platform', true) = 'on');
