-- Links a contribution to the transfer it was recorded from.
--
-- A deposit into a TFSA, RRSP or FHSA synced from the bank arrives as a TRANSFER row, but
-- contribution room only counts InvestmentFlow rows, so it had to be entered a second time by
-- hand. "Count toward room" on the Investments card now records the flow from the transfer and
-- keeps the transfer's id here. The unique index is what stops one transfer being counted twice;
-- SET NULL keeps the contribution if the transfer is later deleted, since it still used room.
--
-- Hand-written like every migration here (see AGENTS.md). SQLite cannot add a foreign key to an
-- existing table, so it is rebuilt in Prisma's RedefineTables shape. That is safe because every
-- database holds exactly the same InvestmentFlow columns at this point: none has been added since
-- 20260422145651_init_finance_tracker created the table. The column is also listed in
-- REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both files.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InvestmentFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "direction" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvestmentFlow_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InvestmentFlow" ("accountId", "amountCents", "createdAt", "date", "direction", "id", "note", "userId") SELECT "accountId", "amountCents", "createdAt", "date", "direction", "id", "note", "userId" FROM "InvestmentFlow";
DROP TABLE "InvestmentFlow";
ALTER TABLE "new_InvestmentFlow" RENAME TO "InvestmentFlow";
CREATE UNIQUE INDEX "InvestmentFlow_transactionId_key" ON "InvestmentFlow"("transactionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

