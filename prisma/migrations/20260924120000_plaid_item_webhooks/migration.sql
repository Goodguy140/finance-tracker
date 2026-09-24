-- State raised by Plaid ITEM webhooks, and the webhook URL each item is registered with.
--
-- Until now the only way the app learned a bank needed attention was a sync failing. Plaid
-- tells us sooner — ITEM_LOGIN_REQUIRED, PENDING_EXPIRATION, PENDING_DISCONNECT,
-- NEW_ACCOUNTS_AVAILABLE — and these columns hold what it said until the user acts on it
-- (update mode) or Plaid withdraws it (LOGIN_REPAIRED).
--
-- ADD COLUMNs on an existing table, so each has a matching entry in REQUIRED_SCHEMA_COLUMNS
-- (src/lib/migration-health.ts) and COLUMN_REPAIRS (scripts/repair-sqlite-schema-lib.cjs).

-- AlterTable
ALTER TABLE "PlaidItem" ADD COLUMN "pendingExpirationAt" DATETIME;
ALTER TABLE "PlaidItem" ADD COLUMN "pendingDisconnectAt" DATETIME;
ALTER TABLE "PlaidItem" ADD COLUMN "pendingDisconnectReason" TEXT;
ALTER TABLE "PlaidItem" ADD COLUMN "newAccountsAvailableAt" DATETIME;
ALTER TABLE "PlaidItem" ADD COLUMN "webhookUrl" TEXT;
