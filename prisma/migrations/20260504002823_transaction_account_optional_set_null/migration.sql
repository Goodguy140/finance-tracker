-- Rebuilds Transaction to make accountId optional with ON DELETE SET NULL.
--
-- `preCreditCents` and `creditCents` are carried through deliberately. They are added by
-- the migration immediately before this one (20260503220000_expense_credit_breakdown), and
-- the original version of this file listed them in neither the new table nor the INSERT --
-- so replaying the history produced a Transaction missing two columns the datamodel has,
-- and any values already stored in them were dropped. That went unnoticed because
-- scripts/repair-sqlite-schema.cjs adds both back at runtime on every container start.
--
-- Editing an applied migration is normally off-limits. It is safe in this specific case:
-- the file only ever runs again during a *fresh* replay, where both columns exist by this
-- point, and any database that already applied it has the migration recorded and never
-- re-runs it. Verified against Prisma 6.19 that `migrate deploy` does not reject the
-- changed checksum on an existing database.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "preCreditCents" INTEGER,
    "creditCents" INTEGER,
    "title" TEXT,
    "date" DATETIME NOT NULL,
    "postedDate" DATETIME,
    "accountDescription" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountDescription", "accountId", "amountCents", "categoryId", "createdAt", "creditCents", "date", "id", "note", "postedDate", "preCreditCents", "title", "type", "updatedAt", "userId") SELECT "accountDescription", "accountId", "amountCents", "categoryId", "createdAt", "creditCents", "date", "id", "note", "postedDate", "preCreditCents", "title", "type", "updatedAt", "userId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
