-- Review status for transactions that arrive without the user entering them (file imports,
-- recurring auto-posts, the API).
--
-- Hand-written like every migration here (see AGENTS.md). The column is also in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
