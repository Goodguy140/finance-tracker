-- Months marked closed on the monthly review.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "MonthClose" (
    "userId" TEXT NOT NULL,
    "ym" TEXT NOT NULL,
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "ym"),
    CONSTRAINT "MonthClose_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
