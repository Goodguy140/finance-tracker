-- A rule action that books matching transactions as transfers between the user's own
-- accounts, optionally naming the account on the other side.
--
-- Hand-written like every migration here (see AGENTS.md). Both are new columns on an existing
-- table, so they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files. ADD COLUMN ... REFERENCES rather than a table
-- rebuild, as with `addTagId`.

-- AlterTable
ALTER TABLE "TransactionRule" ADD COLUMN "markAsTransfer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TransactionRule" ADD COLUMN "setTransferAccountId" TEXT REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
