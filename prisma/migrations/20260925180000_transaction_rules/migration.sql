-- User-defined transaction rules, and the opt-out list for learned Title → Category combos.
--
-- Diffed from the previous schema.prisma to this one (not from the migration history, which
-- cannot be trusted as a baseline here — see AGENTS.md). Two new tables and no change to any
-- existing column, so REQUIRED_SCHEMA_COLUMNS, COLUMN_REPAIRS and SCHEMA_REPAIR_VERSION are
-- untouched.

-- CreateTable
CREATE TABLE "TransactionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "titleOperator" TEXT NOT NULL,
    "titlePattern" TEXT NOT NULL,
    "transactionType" TEXT,
    "matchAccountId" TEXT,
    "minAmountCents" INTEGER,
    "maxAmountCents" INTEGER,
    "setCategoryId" TEXT,
    "setTitle" TEXT,
    "setAmountCents" INTEGER,
    "setAccountId" TEXT,
    "appendNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransactionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionRule_matchAccountId_fkey" FOREIGN KEY ("matchAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionRule_setCategoryId_fkey" FOREIGN KEY ("setCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionRule_setAccountId_fkey" FOREIGN KEY ("setAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HiddenTitleSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HiddenTitleSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TransactionRule_userId_priority_idx" ON "TransactionRule"("userId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "HiddenTitleSuggestion_userId_titleKey_key" ON "HiddenTitleSuggestion"("userId", "titleKey");

