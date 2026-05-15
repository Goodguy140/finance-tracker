import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const { runRepair, tableColumns } = require("../../scripts/repair-sqlite-schema-lib.cjs") as {
  runRepair: (prisma: PrismaClient) => Promise<void>;
  tableColumns: (prisma: PrismaClient, table: string) => Promise<Set<string>>;
};

function prismaForFile(dbPath: string) {
  return new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
}

/** Drifted schema: Transaction missing credit columns; User/Account present so other repairs no-op. */
async function createDriftedSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Account" (
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
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Transaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "amountCents" INTEGER NOT NULL
    )
  `);
}

describe("repair-sqlite-schema runRepair", () => {
  let tempDir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "repair-sqlite-schema-"));
    dbPath = path.join(tempDir, "test.db");
    prisma = prismaForFile(dbPath);
    await createDriftedSchema(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds preCreditCents and creditCents when missing on a drifted Transaction table", async () => {
    const before = await tableColumns(prisma, "Transaction");
    expect(before.has("preCreditCents")).toBe(false);
    expect(before.has("creditCents")).toBe(false);

    await runRepair(prisma);

    const after = await tableColumns(prisma, "Transaction");
    expect(after.has("preCreditCents")).toBe(true);
    expect(after.has("creditCents")).toBe(true);
    expect(after.has("creditBreakdownJson")).toBe(true);
  });

  it("is idempotent when credit columns already exist", async () => {
    await runRepair(prisma);
    const afterFirst = await tableColumns(prisma, "Transaction");

    await runRepair(prisma);
    const afterSecond = await tableColumns(prisma, "Transaction");

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.has("preCreditCents")).toBe(true);
    expect(afterSecond.has("creditCents")).toBe(true);
  });

  it("records repair marker when ServerSetting table exists", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ServerSetting" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "key" TEXT NOT NULL UNIQUE,
        "encryptedValue" TEXT NOT NULL,
        "updatedByUserId" TEXT,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runRepair(prisma);

    const marker = await prisma.serverSetting.findUnique({
      where: { key: "ops.lastSchemaRepairAt" },
    });
    expect(marker?.encryptedValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
