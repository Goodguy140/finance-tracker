-- Safe to spend's buffer: how many days after today it also holds back bills that fall next
-- month. Null (every existing user) keeps today's behaviour, bills to month end only.
--
-- Hand-written like every migration here (see AGENTS.md). The column is also in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "safeToSpendBufferDays" INTEGER;
