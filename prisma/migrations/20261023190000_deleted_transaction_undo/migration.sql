-- Undo for deleted expenses and income: the deleted row and everything hanging off it,
-- kept for a few minutes so it can be put back exactly as it was.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "DeletedTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeletedTransaction_userId_deletedAt_idx" ON "DeletedTransaction"("userId", "deletedAt");
