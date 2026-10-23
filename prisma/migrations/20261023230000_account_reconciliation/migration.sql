-- Statements the user has reconciled the log against, one row per account and period.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "AccountReconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "openingCents" INTEGER NOT NULL,
    "closingCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountReconciliation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountReconciliation_accountId_endDate_idx" ON "AccountReconciliation"("accountId", "endDate");

-- CreateIndex
CREATE INDEX "AccountReconciliation_userId_idx" ON "AccountReconciliation"("userId");
