-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING_QR', 'CONNECTED', 'DISCONNECTED', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'AUTO_REPLIED', 'FLAGGED_FOR_REVIEW', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('SKIP_REPLY', 'FORCE_GREETING', 'FORCE_CATEGORY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "rateLimitHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING_QR',
    "phoneNumber" TEXT,
    "qrCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "messageType" TEXT NOT NULL,
    "rawText" TEXT,
    "mediaBase64" TEXT,
    "isGreetingOrWish" BOOLEAN,
    "isForwardedContent" BOOLEAN,
    "confidenceScore" DOUBLE PRECISION,
    "detectedLanguage" TEXT,
    "suggestedReply" TEXT,
    "finalReply" TEXT,
    "matchedRuleId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "isRegex" BOOLEAN NOT NULL DEFAULT true,
    "action" "RuleAction" NOT NULL,
    "forcedReply" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_apiKey_key" ON "tenants"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_tenantId_id_key" ON "whatsapp_sessions"("tenantId", "id");

-- CreateIndex
CREATE INDEX "message_logs_tenantId_remoteJid_idx" ON "message_logs"("tenantId", "remoteJid");

-- CreateIndex
CREATE INDEX "message_logs_tenantId_status_idx" ON "message_logs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "correction_rules_tenantId_active_idx" ON "correction_rules"("tenantId", "active");

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_rules" ADD CONSTRAINT "correction_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
