/**
 * Idempotent SQLite schema repair after `prisma migrate deploy`.
 * Fixes drift when _prisma_migrations lists a migration as applied but ALTER TABLE never ran
 * (restored DB, partial failure, etc.). Safe on fresh DBs — skips columns that already exist.
 */
const { PrismaClient } = require("@prisma/client");
const { resolveDatabaseUrl } = require("./database-url.cjs");
const { runRepair } = require("./repair-sqlite-schema-lib.cjs");

async function main() {
  // The same database `migrate deploy` just migrated and the server is about to open, with
  // or without DATABASE_URL set.
  const url = resolveDatabaseUrl();
  if (!url.startsWith("file:")) {
    return;
  }
  process.env.DATABASE_URL = url;

  const prisma = new PrismaClient();
  try {
    await runRepair(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("repair-sqlite-schema failed:", err);
  process.exit(1);
});
