-- The dashboard's "Get started" checklist can be hidden; this records when.
--
-- Hand-written like every migration here (see AGENTS.md). A new column on an existing table,
-- so it is also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files (to 16).
ALTER TABLE "User" ADD COLUMN "getStartedDismissedAt" DATETIME;
