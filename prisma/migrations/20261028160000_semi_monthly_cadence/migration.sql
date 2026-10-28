-- Twice-a-month recurring rules: RecurringCadence gains SEMI_MONTHLY (SQLite stores enum values
-- as TEXT, so existing rows are unchanged), with the rule's second day and whether a date on a
-- weekend moves to the Friday before.
--
-- Hand-written like every migration here (see AGENTS.md). The columns are also in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN "secondAnchorDay" INTEGER;
ALTER TABLE "RecurringTransaction" ADD COLUMN "beforeWeekend" BOOLEAN NOT NULL DEFAULT false;
