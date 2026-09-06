-- Rate limiting moves from hours to minutes so tenants can set sub-hour windows.
-- Rename first, then scale existing values (24h -> 1440m), then reset the default.
ALTER TABLE "tenants" RENAME COLUMN "rateLimitHours" TO "rateLimitMinutes";

UPDATE "tenants" SET "rateLimitMinutes" = "rateLimitMinutes" * 60;

ALTER TABLE "tenants" ALTER COLUMN "rateLimitMinutes" SET DEFAULT 1440;
