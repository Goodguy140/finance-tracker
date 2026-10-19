-- Recurring transfers between the user's own accounts, and an option to apply them to
-- projected balances.
--
-- A transfer rule names the account the money goes to as well as the one it leaves, so each
-- posted transfer carries both sides and a projection can move the money from one account to
-- the other. The option is off for every existing user, which keeps today's projections.
--
-- Hand-written like every migration here (see AGENTS.md). Both are new columns on existing
-- tables, so they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files (to 15). ADD COLUMN ... REFERENCES rather than a
-- table rebuild, as with `setTransferAccountId`.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "projectionIncludesTransfers" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN "transferAccountId" TEXT REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
