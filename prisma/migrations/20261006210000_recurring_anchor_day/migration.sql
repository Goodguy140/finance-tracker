-- The day of the month a recurring rule falls on.
--
-- A monthly rule on the 31st was stored only as its next date, so posting Jan 31 moved it to
-- Feb 28 and every later month advanced from the 28th: the rule drifted to the 28th for good.
-- `anchorDay` keeps the day the user chose, and each month is clamped from it instead.
--
-- Hand-written like every migration here (see AGENTS.md). Nullable with no backfill: a rule
-- without one falls back to its next date's day (`recurringAnchorDay`) and stores it the first
-- time it is posted or skipped. The column is also listed in REQUIRED_SCHEMA_COLUMNS and
-- COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN "anchorDay" INTEGER;
