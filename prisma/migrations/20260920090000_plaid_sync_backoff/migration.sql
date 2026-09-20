-- Backoff state for failing bank connections.
--
-- Without it, an item whose sync fails is never marked as synced, stays permanently "due",
-- and is retried on every sweep — hourly, forever, for a call that cannot succeed until a
-- person intervenes. That spends Plaid rate limit continuously and, on per-request
-- pricing, money.
--
-- Two ADD COLUMNs on an existing table, so this needs matching entries in
-- REQUIRED_SCHEMA_COLUMNS (src/lib/migration-health.ts) and COLUMN_REPAIRS
-- (scripts/repair-sqlite-schema-lib.cjs) — unlike the earlier Plaid migration, which only
-- created new tables.

-- AlterTable
ALTER TABLE "PlaidItem" ADD COLUMN "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlaidItem" ADD COLUMN "nextSyncAttemptAt" DATETIME;
