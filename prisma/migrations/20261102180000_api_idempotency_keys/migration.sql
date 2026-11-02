-- `Idempotency-Key` on `POST /api/v1/transactions`: the phone app sends one per add, so a retry
-- after a dropped connection returns the entry already made instead of adding it twice.
--
-- Hand-written like every migration here (see AGENTS.md). A new table only, so nothing goes in
-- REQUIRED_SCHEMA_COLUMNS or COLUMN_REPAIRS.

-- CreateTable
CREATE TABLE "ApiIdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiIdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ApiIdempotencyKey_createdAt_idx" ON "ApiIdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyKey_userId_key_key" ON "ApiIdempotencyKey"("userId", "key");
