-- Which accounts count as savings.
--
-- Transfers are left out of every total because they only move money between the user's own
-- accounts. A transfer into a savings account is still money set aside, so Reports and the
-- financial score's savings rate count transfers into these accounts as saved and transfers
-- out of them as taken back.
--
-- Hand-written like every migration here (see AGENTS.md). Savings and investment accounts
-- start marked so the feature works without a trip to Settings; chequing, credit cards and
-- cash do not. The column is also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "countsAsSavings" BOOLEAN NOT NULL DEFAULT false;

-- Backfill
UPDATE "Account" SET "countsAsSavings" = true WHERE "type" IN ('SAVINGS', 'TFSA', 'RRSP', 'FHSA', 'NON_REGISTERED');
