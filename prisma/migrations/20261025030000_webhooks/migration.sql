-- Outbound webhooks: endpoints a user sets in Settings → Developer, and the delivery queue.
--
-- Hand-written like every migration here (see AGENTS.md). New tables only, so nothing goes
-- in REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" DATETIME,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_userId_idx" ON "WebhookEndpoint"("userId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_deliveredAt_nextAttemptAt_idx" ON "WebhookDelivery"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_dedupeKey_key" ON "WebhookDelivery"("endpointId", "dedupeKey");
