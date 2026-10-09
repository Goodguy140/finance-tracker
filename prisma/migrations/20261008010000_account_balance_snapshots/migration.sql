-- Account balances over time, for net worth.
--
-- Filled from the balances Plaid already returns with /transactions/sync (the billed
-- /accounts/balance/get is never called) for mapped accounts, and by hand for accounts with
-- no bank feed. One row per account per day.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS. The new LOAN and PROPERTY account types need
-- no SQL: SQLite stores enums as text.

-- CreateTable
CREATE TABLE "AccountBalanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountBalanceSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountBalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountBalanceSnapshot_userId_date_idx" ON "AccountBalanceSnapshot"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBalanceSnapshot_accountId_date_key" ON "AccountBalanceSnapshot"("accountId", "date");
