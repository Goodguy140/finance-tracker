-- TFSA, RRSP and FHSA contribution room: the yearly figure a user copies from CRA. Remaining
-- room is computed from InvestmentFlow, not stored.
--
-- Hand-written like every migration here (see AGENTS.md). One new table and no new column on
-- an existing one, so nothing is needed in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS and
-- SCHEMA_REPAIR_VERSION stays where it is.

-- CreateTable
CREATE TABLE "ContributionRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "roomCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContributionRoom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ContributionRoom_userId_accountType_year_key" ON "ContributionRoom"("userId", "accountType", "year");
