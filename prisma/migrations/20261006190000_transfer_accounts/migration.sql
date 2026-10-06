-- Gives a transfer the account on its other side, and links the two legs of one transfer.
--
-- A transfer row records only the account it touched, so a card payment read "Out of
-- Chequing" with nowhere for the money to have gone, and when both banks are linked the
-- payment arrived as two unrelated rows. `transferAccountId` is the other account;
-- `transferPeerId` is the other leg when both are in the log, set on both, unique so a leg
-- pairs with at most one other.
--
-- Hand-written like every migration here (see AGENTS.md). Unlike the InvestmentFlow and User
-- changes, Transaction is not rebuilt to add the foreign keys: its column set is not the same
-- on every database (20260504002823 dropped two columns that only the repair script put back),
-- so a RedefineTables INSERT list would be right for some deployments and wrong for others.
-- SQLite accepts a REFERENCES clause on ADD COLUMN when the column defaults to NULL, which
-- enforces the same SET NULL action without touching the existing columns. Both columns are
-- also in REQUIRED_SCHEMA_COLUMNS and COLUMN_REPAIRS, with SCHEMA_REPAIR_VERSION bumped in both.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "transferAccountId" TEXT REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD COLUMN "transferPeerId" TEXT REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_transferPeerId_key" ON "Transaction"("transferPeerId");
