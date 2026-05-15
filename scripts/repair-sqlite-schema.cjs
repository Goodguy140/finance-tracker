/**
 * Idempotent SQLite schema repair after `prisma migrate deploy`.
 * Fixes drift when _prisma_migrations lists a migration as applied but ALTER TABLE never ran
 * (restored DB, partial failure, etc.). Safe on fresh DBs — skips columns that already exist.
 */
const { PrismaClient } = require("@prisma/client");
const { runRepair } = require("./repair-sqlite-schema-lib.cjs");

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.trim().startsWith("file:")) {
    return;
  }

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
