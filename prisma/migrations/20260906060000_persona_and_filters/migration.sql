-- Persona, reply-targeting controls, and a per-contact allow/block list.

CREATE TYPE "ContactPolicy" AS ENUM ('ALL', 'ALLOWLIST');
CREATE TYPE "ContactFilterType" AS ENUM ('ALLOW', 'BLOCK');

ALTER TABLE "tenants"
  ADD COLUMN "assistantName" TEXT,
  ADD COLUMN "ownerName" TEXT,
  ADD COLUMN "businessInfo" TEXT,
  ADD COLUMN "personaInstructions" TEXT,
  ADD COLUMN "replyToGroups" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "greetingsOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contactPolicy" "ContactPolicy" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "autoReplyBurstLimit" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "message_logs" ADD COLUMN "senderName" TEXT;

CREATE TABLE "contact_filters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "type" "ContactFilterType" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_filters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_filters_tenantId_jid_key" ON "contact_filters"("tenantId", "jid");
CREATE INDEX "contact_filters_tenantId_type_idx" ON "contact_filters"("tenantId", "type");

ALTER TABLE "contact_filters" ADD CONSTRAINT "contact_filters_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
