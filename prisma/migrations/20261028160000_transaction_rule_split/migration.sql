-- Rules that split a transaction: the lines of a rule's "Split by percentage" action.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "TransactionRuleSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    CONSTRAINT "TransactionRuleSplit_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TransactionRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionRuleSplit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionRuleSplit_ruleId_position_key" ON "TransactionRuleSplit"("ruleId", "position");

-- CreateIndex
CREATE INDEX "TransactionRuleSplit_categoryId_idx" ON "TransactionRuleSplit"("categoryId");
