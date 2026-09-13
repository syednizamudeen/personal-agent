-- Default new tenants to replying only to greetings/wishes, and flip every existing
-- tenant to the same setting. Follows the 2026-09-13 incident where a tenant's
-- groupReplyMode was left permissive and the assistant auto-replied broadly in a
-- group chat; greetingsOnly is the narrowest safe default until an operator
-- deliberately opens up auto-replies for a tenant.
ALTER TABLE "tenants" ALTER COLUMN "greetingsOnly" SET DEFAULT true;

UPDATE "tenants" SET "greetingsOnly" = true;
