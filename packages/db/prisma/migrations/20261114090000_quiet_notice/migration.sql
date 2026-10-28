-- Phase 19: remember when a quiet company was last sent a check-in email, so it is not written to again for a month.
ALTER TABLE "Organization" ADD COLUMN "quietNoticeAt" TIMESTAMP(3);
