-- Budget rollover, opt-in per expense category.
--
-- When set, what is left of the category's budget each month from this one on (or what went
-- over it) carries into the next month's budget. Null means rollover is off, which is every
-- existing category: nothing changes until the user turns it on.
--
-- Hand-written like every migration here (see AGENTS.md). The column is also listed in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files (to 13).

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "rolloverSinceMonth" TEXT;
