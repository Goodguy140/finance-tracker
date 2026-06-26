-- Shared subscription support: people who split a recurring expense, and per-occurrence
-- tracking of whether each person was sent the bill and has paid.

-- CreateTable
CREATE TABLE "SubscriptionMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "recurringTransactionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shareCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionMember_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "RecurringTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionShareStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "recurringTransactionId" TEXT NOT NULL,
    "expectedDate" DATETIME NOT NULL,
    "billSent" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionShareStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionShareStatus_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "SubscriptionMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionShareStatus_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "RecurringTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SubscriptionMember_userId_idx" ON "SubscriptionMember"("userId");

-- CreateIndex
CREATE INDEX "SubscriptionMember_recurringTransactionId_idx" ON "SubscriptionMember"("recurringTransactionId");

-- CreateIndex
CREATE INDEX "SubscriptionShareStatus_userId_idx" ON "SubscriptionShareStatus"("userId");

-- CreateIndex
CREATE INDEX "SubscriptionShareStatus_recurringTransactionId_expectedDate_idx" ON "SubscriptionShareStatus"("recurringTransactionId", "expectedDate");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionShareStatus_memberId_expectedDate_key" ON "SubscriptionShareStatus"("memberId", "expectedDate");
