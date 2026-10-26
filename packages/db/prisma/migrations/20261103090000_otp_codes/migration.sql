-- Phase 11b: one-time codes sent by email.
-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpCode_email_purpose_createdAt_idx" ON "OtpCode"("email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_userId_purpose_usedAt_idx" ON "OtpCode"("userId", "purpose", "usedAt");
