-- Financial score signals: a MORTGAGE account type kept apart from other loans, an optional birth
-- year on the user, a need/want role on categories, and one score snapshot per user per month.
--
-- AccountType gains MORTGAGE and SpendingRole is new: SQLite stores enum values as TEXT, so
-- neither needs DDL and existing rows are unchanged.
--
-- Hand-written like every migration here (see AGENTS.md). The two columns are also in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "birthYear" INTEGER;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "spendingRole" TEXT;

-- CreateTable
CREATE TABLE "FinancialScoreSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialScoreSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialScoreSnapshot_userId_month_key" ON "FinancialScoreSnapshot"("userId", "month");
