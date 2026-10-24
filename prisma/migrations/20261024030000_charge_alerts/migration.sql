-- Large or unusual charge alerts: one settings row per user who turned them on.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "ChargeAlertSetting" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "thresholdCents" INTEGER,
    "unusual" BOOLEAN NOT NULL DEFAULT false,
    "checkedThrough" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChargeAlertSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
