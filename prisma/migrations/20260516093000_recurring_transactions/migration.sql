-- Create generalized recurring transaction rules and migrate existing subscriptions into expense rules.

-- CreateTable
CREATE TABLE "RecurringTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cadence" TEXT NOT NULL,
    "nextExpectedDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "postMode" TEXT NOT NULL DEFAULT 'REVIEW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Preserve old subscription IDs where practical so external references remain recognizable.
INSERT INTO "RecurringTransaction" (
    "id",
    "userId",
    "accountId",
    "categoryId",
    "type",
    "name",
    "amountCents",
    "cadence",
    "nextExpectedDate",
    "postMode",
    "enabled",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "userId",
    "accountId",
    "categoryId",
    'EXPENSE',
    "name",
    "amountCents",
    "billingCycle",
    "nextChargeDate",
    'REVIEW',
    true,
    "createdAt",
    "updatedAt"
FROM "Subscription";

-- Add optional source metadata to posted transactions. The unique index prevents double posting the same
-- recurring occurrence while allowing ordinary transactions to remain unconstrained.
ALTER TABLE "Transaction" ADD COLUMN "recurringTransactionId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "recurringExpectedDate" DATETIME;

-- CreateIndex
CREATE INDEX "RecurringTransaction_userId_enabled_nextExpectedDate_idx" ON "RecurringTransaction"("userId", "enabled", "nextExpectedDate");

-- CreateIndex
CREATE INDEX "RecurringTransaction_userId_type_idx" ON "RecurringTransaction"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_recurringTransactionId_recurringExpectedDate_key" ON "Transaction"("userId", "recurringTransactionId", "recurringExpectedDate");

-- Retire the old subscription table after data migration so there is only one user-facing recurring system.
DROP TABLE "Subscription";
