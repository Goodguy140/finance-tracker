-- Spending insights: which findings a user dismissed or snoozed, and whether habit spending
-- (tobacco, cannabis, alcohol, gambling, in-game purchases) is analysed at all.
--
-- Hand-written like every migration here (see AGENTS.md). Two new tables and no new column
-- on an existing one, so nothing is needed in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS and
-- SCHEMA_REPAIR_VERSION stays where it is.

-- CreateTable
CREATE TABLE "InsightDismissal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "insightKey" TEXT NOT NULL,
    "snoozedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsightPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "habitDetectionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InsightPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InsightDismissal_userId_insightKey_key" ON "InsightDismissal"("userId", "insightKey");

-- CreateIndex
CREATE UNIQUE INDEX "InsightPreference_userId_key" ON "InsightPreference"("userId");
