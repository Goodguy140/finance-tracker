/** Keep in sync with SCHEMA_REPAIR_VERSION in src/lib/migration-health.ts */
const SCHEMA_REPAIR_VERSION = "2";
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
];

async function tableColumns(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((row) => row.name));
}

async function runRepair(prisma) {
  for (const repair of COLUMN_REPAIRS) {
    const columns = await tableColumns(prisma, repair.table);
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

module.exports = { COLUMN_REPAIRS, tableColumns, runRepair, SCHEMA_REPAIR_VERSION };
