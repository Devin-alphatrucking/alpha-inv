-- Phase 17b: remember which trial notices were sent, so each goes out once per trial.
ALTER TABLE "Subscription" ADD COLUMN "trialEndingNoticeAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "trialEndedNoticeAt" TIMESTAMP(3);
