-- Per-user thresholds for how much text the dashboard keeps readable before merging a column
-- away: one for each card's text as a whole, one for each budget name on its own. Adds
-- columns with defaults; nothing here touches existing rows.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "dashboardTextVisiblePct" INTEGER NOT NULL DEFAULT 95;
ALTER TABLE "User" ADD COLUMN "dashboardBudgetNameVisiblePct" INTEGER NOT NULL DEFAULT 90;
