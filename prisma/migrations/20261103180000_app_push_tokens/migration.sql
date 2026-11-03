-- Phone app alerts: `AppPushToken` is a signed-in phone's Apple push (APNs) registration and the
-- alerts it wants. Deleted with its `AppDevice`, so signing a phone out stops its alerts.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes in
-- REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "AppPushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appDeviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "billReminders" BOOLEAN NOT NULL DEFAULT true,
    "chargeAlerts" BOOLEAN NOT NULL DEFAULT true,
    "budgetAlerts" BOOLEAN NOT NULL DEFAULT true,
    "hideAmounts" BOOLEAN NOT NULL DEFAULT false,
    "lastSentAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppPushToken_appDeviceId_fkey" FOREIGN KEY ("appDeviceId") REFERENCES "AppDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AppPushToken_appDeviceId_key" ON "AppPushToken"("appDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token");

-- CreateIndex
CREATE INDEX "AppPushToken_userId_idx" ON "AppPushToken"("userId");
