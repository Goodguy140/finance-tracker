-- Connecting a bank from the phone app: `AppBankLink` is one Plaid Link session the app started
-- after Face ID, which allows finishing it once, from that phone, before it expires.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes in
-- REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "AppBankLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "appDeviceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "plaidItemId" TEXT,
    "updateKind" TEXT,
    "historyDays" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppBankLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppBankLink_appDeviceId_fkey" FOREIGN KEY ("appDeviceId") REFERENCES "AppDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AppBankLink_userId_idx" ON "AppBankLink"("userId");

-- CreateIndex
CREATE INDEX "AppBankLink_appDeviceId_idx" ON "AppBankLink"("appDeviceId");
