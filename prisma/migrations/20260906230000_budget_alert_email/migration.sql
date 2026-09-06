-- Server-side budget alert emails: a per-user opt-in and a record of what was sent.
-- Adds a column with a default and a new table; nothing here touches existing rows.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "budgetAlertEmailEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BudgetAlertNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetAlertNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetAlertNotification_userId_periodMonth_categoryId_severity_key" ON "BudgetAlertNotification"("userId", "periodMonth", "categoryId", "severity");
