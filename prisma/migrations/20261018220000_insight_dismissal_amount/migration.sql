-- How big a dismissed insight was when it was dismissed, in cents a year.
--
-- A dismissal used to hide its insight for good however much worse it got: dismiss "Delivery
-- apps: $110 a month" and it never came back, even at $400. Insights now show again once they
-- are half as big again as when they were dismissed. Null for every existing row (and for
-- insights with no amount), which keeps today's behaviour for them.
--
-- Hand-written like every migration here (see AGENTS.md). The column is also listed in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files (to 14).

-- AlterTable
ALTER TABLE "InsightDismissal" ADD COLUMN "dismissedCents" INTEGER;
