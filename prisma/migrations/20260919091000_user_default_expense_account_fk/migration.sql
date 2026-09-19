-- Adds the missing foreign key on User.defaultExpenseAccountId.
--
-- 20260511120000_user_default_expense_account added the column as a bare TEXT with no
-- REFERENCES clause, while schema.prisma has always declared the relation with
-- `onDelete: SetNull`. The result is that the referential action is enforced nowhere --
-- not on a fresh replay, and not on any existing database -- so deleting an Account that
-- someone had set as their default expense account leaves a dangling id behind rather
-- than nulling it.
--
-- SQLite cannot add a constraint to an existing column, so the table is rebuilt. This is
-- the standard Prisma RedefineTables shape, and it is safe as a plain migration (unlike
-- the Transaction rebuild that this history already got wrong) because every database --
-- fresh replay or live -- holds exactly the same User columns at this point, so the
-- INSERT column list below cannot be wrong for some deployments and right for others.
--
-- The rebuild also restores the column order to match the datamodel; the four columns
-- added by later ALTER TABLE statements had been left appended at the end.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "countryCode" TEXT NOT NULL DEFAULT 'CA',
    "emailVerifiedAt" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" DATETIME,
    "defaultExpenseAccountId" TEXT,
    "budgetAlertEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_defaultExpenseAccountId_fkey" FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("budgetAlertEmailEnabled", "countryCode", "createdAt", "defaultExpenseAccountId", "disabledAt", "displayName", "email", "emailVerifiedAt", "id", "passwordHash", "role", "timezone", "tokenVersion", "updatedAt") SELECT "budgetAlertEmailEnabled", "countryCode", "createdAt", "defaultExpenseAccountId", "disabledAt", "displayName", "email", "emailVerifiedAt", "id", "passwordHash", "role", "timezone", "tokenVersion", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
