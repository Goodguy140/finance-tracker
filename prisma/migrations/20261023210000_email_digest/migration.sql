-- The emailed spending digest: how often a user wants it, and the last period one went out for.
-- Off for every existing user.
--
-- Hand-written like every migration here (see AGENTS.md). New columns on an existing table,
-- so they are also listed in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with
-- SCHEMA_REPAIR_VERSION bumped in both files (to 16).
ALTER TABLE "User" ADD COLUMN "digestFrequency" TEXT NOT NULL DEFAULT 'OFF';
ALTER TABLE "User" ADD COLUMN "digestLastPeriodKey" TEXT;
