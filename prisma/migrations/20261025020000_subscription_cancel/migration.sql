-- Subscription cancel helper: where to cancel, a decide-by date and its reminder, and when
-- the subscription was cancelled.
--
-- Hand-written like every migration here (see AGENTS.md). The columns are also in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN "cancelUrl" TEXT;
ALTER TABLE "RecurringTransaction" ADD COLUMN "decideBy" DATETIME;
ALTER TABLE "RecurringTransaction" ADD COLUMN "decideRemindedFor" DATETIME;
ALTER TABLE "RecurringTransaction" ADD COLUMN "cancelledAt" DATETIME;
