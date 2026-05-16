-- Rebuild AuditLog to match application schema (nullable userId, target columns, metadataJson, indexes).
-- Follows interim migration 20260515140000 which used a narrower column set.

PRAGMA foreign_keys=OFF;

CREATE TABLE "AuditLog_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadataJson" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_new_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "AuditLog_new" ("id", "userId", "action", "targetType", "targetId", "metadataJson", "ipAddress", "userAgent", "createdAt")
SELECT
  "id",
  "userId",
  "action",
  NULL,
  NULL,
  "metadata",
  "ip",
  "userAgent",
  "createdAt"
FROM "AuditLog";

DROP TABLE "AuditLog";
ALTER TABLE "AuditLog_new" RENAME TO "AuditLog";

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

PRAGMA foreign_keys=ON;
