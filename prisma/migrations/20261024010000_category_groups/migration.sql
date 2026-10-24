-- Category groups: an optional heading each category is filed under, for group totals.
--
-- Hand-written like every migration here (see AGENTS.md). A new column on an existing table,
-- so it is also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files (to 20).
ALTER TABLE "Category" ADD COLUMN "groupName" TEXT;
