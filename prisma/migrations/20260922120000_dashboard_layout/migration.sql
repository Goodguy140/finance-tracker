-- Per-user desktop dashboard layout: column widths, card placement, stacks and per-card
-- settings, stored as one JSON blob validated by src/lib/dashboard-layout/schema.ts.
--
-- Hand-written rather than generated, like every migration here: `prisma migrate diff
-- --from-migrations` cannot be trusted as a baseline in this repo (20260503220000 adds
-- Transaction.preCreditCents/.creditCents and 20260504002823 rebuilds the table without
-- them), so a replay of the history does not reproduce the datamodel.
--
-- This creates a table and touches no existing column, so it applies cleanly whether or
-- not scripts/repair-sqlite-schema.cjs has run. A new *table* also needs no entry in
-- REQUIRED_SCHEMA_COLUMNS (src/lib/migration-health.ts) or COLUMN_REPAIRS
-- (scripts/repair-sqlite-schema-lib.cjs) — both are column-only — so SCHEMA_REPAIR_VERSION
-- stays where it is.

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "layoutJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_userId_key" ON "DashboardLayout"("userId");
