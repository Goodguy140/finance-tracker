/** Keep in sync with SCHEMA_REPAIR_VERSION in src/lib/migration-health.ts */
const SCHEMA_REPAIR_VERSION = "10";
const OPS_LAST_SCHEMA_REPAIR_AT = "ops.lastSchemaRepairAt";
const OPS_SCHEMA_REPAIR_VERSION = "ops.schemaRepairVersion";

/** @type {Array<{ table: string; column: string; ddl: string }>} */
const COLUMN_REPAIRS = [
  {
    table: "Transaction",
    column: "preCreditCents",
    ddl: 'ALTER TABLE "Transaction" ADD COLUMN "preCreditCents" INTEGER',
  },
  {
    table: "Transaction",
    column: "creditCents",
    ddl: 'ALTER TABLE "Transaction" ADD COLUMN "creditCents" INTEGER',
  },
  {
    table: "Transaction",
    column: "creditBreakdownJson",
    ddl: 'ALTER TABLE "Transaction" ADD COLUMN "creditBreakdownJson" TEXT',
  },
  {
    table: "User",
    column: "defaultExpenseAccountId",
    ddl: 'ALTER TABLE "User" ADD COLUMN "defaultExpenseAccountId" TEXT',
  },
  {
    table: "User",
    column: "tokenVersion",
    ddl: 'ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: "User",
    column: "budgetAlertEmailEnabled",
    ddl: 'ALTER TABLE "User" ADD COLUMN "budgetAlertEmailEnabled" BOOLEAN NOT NULL DEFAULT false',
  },
  {
    table: "User",
    column: "disabledAt",
    ddl: 'ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME',
  },
  {
    table: "PlaidItem",
    column: "consecutiveSyncFailures",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: "PlaidItem",
    column: "nextSyncAttemptAt",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "nextSyncAttemptAt" DATETIME',
  },
  {
    table: "PlaidItem",
    column: "pendingExpirationAt",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "pendingExpirationAt" DATETIME',
  },
  {
    table: "PlaidItem",
    column: "pendingDisconnectAt",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "pendingDisconnectAt" DATETIME',
  },
  {
    table: "PlaidItem",
    column: "pendingDisconnectReason",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "pendingDisconnectReason" TEXT',
  },
  {
    table: "PlaidItem",
    column: "newAccountsAvailableAt",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "newAccountsAvailableAt" DATETIME',
  },
  {
    table: "PlaidItem",
    column: "webhookUrl",
    ddl: 'ALTER TABLE "PlaidItem" ADD COLUMN "webhookUrl" TEXT',
  },
  {
    table: "User",
    column: "dashboardTextVisiblePct",
    ddl: 'ALTER TABLE "User" ADD COLUMN "dashboardTextVisiblePct" INTEGER NOT NULL DEFAULT 95',
  },
  {
    table: "User",
    column: "dashboardBudgetNameVisiblePct",
    ddl: 'ALTER TABLE "User" ADD COLUMN "dashboardBudgetNameVisiblePct" INTEGER NOT NULL DEFAULT 90',
  },
  {
    table: "InvestmentFlow",
    column: "transactionId",
    ddl: 'ALTER TABLE "InvestmentFlow" ADD COLUMN "transactionId" TEXT',
  },
  {
    table: "Transaction",
    column: "transferAccountId",
    ddl: 'ALTER TABLE "Transaction" ADD COLUMN "transferAccountId" TEXT REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
  },
  {
    table: "Transaction",
    column: "transferPeerId",
    ddl: 'ALTER TABLE "Transaction" ADD COLUMN "transferPeerId" TEXT REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
  },
  {
    table: "RecurringTransaction",
    column: "anchorDay",
    ddl: 'ALTER TABLE "RecurringTransaction" ADD COLUMN "anchorDay" INTEGER',
  },
  {
    table: "TransactionRule",
    column: "addTagId",
    ddl: 'ALTER TABLE "TransactionRule" ADD COLUMN "addTagId" TEXT REFERENCES "Tag" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
  },
];

async function tableColumns(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((row) => row.name));
}

/**
 * Switch the database to write-ahead logging.
 *
 * The default rollback journal takes an exclusive lock for every write, so a single slow
 * write blocks every reader; under WAL, readers and the writer proceed concurrently. That
 * matters as soon as anything writes outside a user's own page load (a scheduled job, a
 * provider webhook) rather than only in response to one.
 *
 * The mode is stored in the database header, so this runs once and persists. WAL needs
 * real file locking and silently stays in the old mode on network filesystems, so the
 * result is checked and reported rather than assumed.
 */
async function enableWriteAheadLogging(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    const mode = String(rows?.[0]?.journal_mode ?? "").toLowerCase();
    if (mode === "wal") return;
    console.warn(
      `repair-sqlite-schema: journal_mode is "${mode}", not WAL — ` +
        "expected on a network filesystem; writes will keep taking an exclusive lock.",
    );
  } catch (err) {
    console.warn("repair-sqlite-schema: could not set journal_mode=WAL:", err?.message ?? err);
  }
}

async function runRepair(prisma) {
  await enableWriteAheadLogging(prisma);

  for (const repair of COLUMN_REPAIRS) {
    const columns = await tableColumns(prisma, repair.table);
    // A table that does not exist at all is not drift this script can fix — PRAGMA
    // table_info returns nothing for it, which is indistinguishable from "column missing",
    // and the ALTER would throw and take startup down with it. Creating tables is the
    // migrations' job; this only ever adds columns to tables that are already there.
    if (columns.size === 0) continue;
    if (columns.has(repair.column)) continue;
    await prisma.$executeRawUnsafe(repair.ddl);
    console.log(`repair-sqlite-schema: added ${repair.table}.${repair.column}`);
  }

  const accountCols = await tableColumns(prisma, "Account");
  if (!accountCols.has("archived")) {
    const accountRebuild = [
      "PRAGMA defer_foreign_keys=ON",
      "PRAGMA foreign_keys=OFF",
      `CREATE TABLE "new_Account" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "currency" TEXT NOT NULL DEFAULT 'CAD',
          "countryCode" TEXT NOT NULL DEFAULT 'CA',
          "provider" TEXT,
          "archived" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
      `INSERT INTO "new_Account" ("countryCode", "createdAt", "currency", "id", "name", "provider", "type", "updatedAt", "userId")
         SELECT "countryCode", "createdAt", "currency", "id", "name", "provider", "type", "updatedAt", "userId" FROM "Account"`,
      'DROP TABLE "Account"',
      'ALTER TABLE "new_Account" RENAME TO "Account"',
      "PRAGMA foreign_keys=ON",
      "PRAGMA defer_foreign_keys=OFF",
    ];
    for (const sql of accountRebuild) {
      await prisma.$executeRawUnsafe(sql);
    }
    console.log("repair-sqlite-schema: added Account.archived");
  }

  await recordRepairMarker(prisma);
}

async function recordRepairMarker(prisma) {
  try {
    const tables = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ServerSetting'`,
    );
    if (!Array.isArray(tables) || tables.length === 0) return;

    const at = new Date().toISOString();
    for (const [key, value] of [
      [OPS_LAST_SCHEMA_REPAIR_AT, at],
      [OPS_SCHEMA_REPAIR_VERSION, SCHEMA_REPAIR_VERSION],
    ]) {
      await prisma.serverSetting.upsert({
        where: { key },
        create: { key, encryptedValue: value },
        update: { encryptedValue: value },
      });
    }
  } catch (err) {
    console.warn("repair-sqlite-schema: could not record repair marker", err);
  }
}

module.exports = {
  COLUMN_REPAIRS,
  tableColumns,
  runRepair,
  enableWriteAheadLogging,
  SCHEMA_REPAIR_VERSION,
};
