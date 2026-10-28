-- Web Push: phones and browsers that receive bill reminders, charge alerts and budget alerts.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "billReminders" BOOLEAN NOT NULL DEFAULT true,
    "chargeAlerts" BOOLEAN NOT NULL DEFAULT true,
    "budgetAlerts" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_endpoint_key" ON "PushDevice"("endpoint");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");
