-- Reimbursements: the part of a one-off expense someone else owes the user. The share is
-- already taken out of Transaction.amountCents, so no total reads this table.
--
-- Hand-written like every migration here (see AGENTS.md). One new table and no new column on
-- an existing one, so nothing is needed in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS and
-- SCHEMA_REPAIR_VERSION stays where it is.

-- CreateTable
CREATE TABLE "OwedShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OwedShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OwedShare_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OwedShare_transactionId_idx" ON "OwedShare"("transactionId");

-- CreateIndex
CREATE INDEX "OwedShare_userId_paidAt_idx" ON "OwedShare"("userId", "paidAt");
