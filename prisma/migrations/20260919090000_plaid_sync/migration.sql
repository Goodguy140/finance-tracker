-- Plaid bank transaction sync: four new tables and one index on an existing one.
--
-- Hand-written rather than generated. `prisma migrate diff --from-migrations` cannot be
-- used as a baseline in this repo: 20260503220000 adds Transaction.preCreditCents and
-- .creditCents, and 20260504002823 then rebuilds the table without them, so a replay of
-- the history produces a Transaction that is missing columns the datamodel has. Those
-- columns are restored on every container start by scripts/repair-sqlite-schema.cjs
-- (they are the first entries in its COLUMN_REPAIRS). Diffing against that replay would
-- emit ADD COLUMN statements for columns that already exist in every live database,
-- which SQLite rejects — taking the whole deployment down.
--
-- Nothing below touches an existing column, so this applies cleanly whether or not the
-- repair script has run.

-- CreateTable
CREATE TABLE "PlaidItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "consentExpiresAt" DATETIME,
    "requestedDays" INTEGER NOT NULL,
    "historyCutoff" DATETIME NOT NULL,
    "earliestObservedAt" DATETIME,
    "initialSyncDoneAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "lastSyncError" TEXT,
    "syncingSince" DATETIME,
    "defaultCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaidItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidItem_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaidAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "plaidType" TEXT NOT NULL,
    "plaidSubtype" TEXT,
    "currency" TEXT,
    "accountId" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaidAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidAccount_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "PlaidItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaidStagedTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidAccountRowId" TEXT NOT NULL,
    "plaidTransactionId" TEXT NOT NULL,
    "pendingPlaidTransactionId" TEXT,
    "isPending" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "merchantName" TEXT,
    "amountCents" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT,
    "date" DATETIME NOT NULL,
    "postedDate" DATETIME,
    "pfcPrimary" TEXT,
    "pfcDetailed" TEXT,
    "suggestedCategoryId" TEXT,
    "suggestedAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "matchTransactionId" TEXT,
    "matchScore" INTEGER,
    "matchTier" TEXT,
    "matchReasonsJson" TEXT,
    "resolvedTransactionId" TEXT,
    "resolvedAt" DATETIME,
    "revisedAfterResolveAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaidStagedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidStagedTransaction_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "PlaidItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaidStagedTransaction_plaidAccountRowId_fkey" FOREIGN KEY ("plaidAccountRowId") REFERENCES "PlaidAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "plaidTransactionId" TEXT,
    "plaidItemId" TEXT,
    "plaidAccountRowId" TEXT,
    "institutionName" TEXT,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedByPlaidAt" DATETIME,
    "itemRemovedAt" DATETIME,
    CONSTRAINT "TransactionVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionVerification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- CreateIndex
CREATE UNIQUE INDEX "PlaidItem_itemId_key" ON "PlaidItem"("itemId");

-- CreateIndex
CREATE INDEX "PlaidItem_userId_idx" ON "PlaidItem"("userId");

-- CreateIndex
CREATE INDEX "PlaidItem_status_lastSyncedAt_idx" ON "PlaidItem"("status", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "PlaidAccount_plaidItemId_idx" ON "PlaidAccount"("plaidItemId");

-- CreateIndex
CREATE INDEX "PlaidAccount_accountId_idx" ON "PlaidAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidAccount_userId_plaidAccountId_key" ON "PlaidAccount"("userId", "plaidAccountId");

-- CreateIndex
CREATE INDEX "PlaidStagedTransaction_userId_status_date_idx" ON "PlaidStagedTransaction"("userId", "status", "date");

-- CreateIndex
CREATE INDEX "PlaidStagedTransaction_pendingPlaidTransactionId_idx" ON "PlaidStagedTransaction"("pendingPlaidTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidStagedTransaction_userId_plaidTransactionId_key" ON "PlaidStagedTransaction"("userId", "plaidTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionVerification_transactionId_key" ON "TransactionVerification"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionVerification_userId_idx" ON "TransactionVerification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionVerification_userId_plaidTransactionId_key" ON "TransactionVerification"("userId", "plaidTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

