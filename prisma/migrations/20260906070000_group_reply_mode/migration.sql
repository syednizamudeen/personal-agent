-- Replace the replyToGroups boolean with a three-way mode so a tenant can stay silent
-- in groups unless @-mentioned, and gain an explicit switch for direct messages.

CREATE TYPE "GroupReplyMode" AS ENUM ('NEVER', 'MENTIONED_ONLY', 'ALWAYS');

ALTER TABLE "tenants"
  ADD COLUMN "replyToDirect" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "groupReplyMode" "GroupReplyMode" NOT NULL DEFAULT 'NEVER';

-- Preserve existing intent: replyToGroups=true behaved as ALWAYS.
UPDATE "tenants" SET "groupReplyMode" = 'ALWAYS' WHERE "replyToGroups" = true;

ALTER TABLE "tenants" DROP COLUMN "replyToGroups";

-- Whether the inbound message @-mentioned this tenant's own number, resolved at
-- capture time from the socket's identity (it is not derivable later).
ALTER TABLE "message_logs" ADD COLUMN "mentionsMe" BOOLEAN NOT NULL DEFAULT false;
