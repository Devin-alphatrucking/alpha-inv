-- Mobile sessions: remember when the refresh token last rotated.
ALTER TABLE "MobileSession" ADD COLUMN "refreshedAt" TIMESTAMP(3);
