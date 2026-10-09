import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  OPS_LAST_SCHEMA_REPAIR_AT,
  OPS_SCHEMA_REPAIR_VERSION,
  checkOAuthDecryptHealth,
  checkSchemaColumnHealth,
  getSchemaRepairMarker,
} from "./migration-health";
import { encryptSecret } from "./security";

function prismaForFile(dbPath: string) {
  return new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
}

async function createMinimalSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ServerSetting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "encryptedValue" TEXT NOT NULL,
      "updatedByUserId" TEXT,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Transaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "preCreditCents" INTEGER,
      "creditCents" INTEGER,
      "creditBreakdownJson" TEXT,
      "transferAccountId" TEXT,
      "transferPeerId" TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "defaultExpenseAccountId" TEXT,
      "tokenVersion" INTEGER NOT NULL DEFAULT 0,
      "budgetAlertEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
      "disabledAt" DATETIME,
      "dashboardTextVisiblePct" INTEGER NOT NULL DEFAULT 95,
      "dashboardBudgetNameVisiblePct" INTEGER NOT NULL DEFAULT 90
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Account" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "archived" BOOLEAN NOT NULL DEFAULT false,
      "countsAsSavings" BOOLEAN NOT NULL DEFAULT false
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "PlaidItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0,
      "nextSyncAttemptAt" DATETIME,
      "pendingExpirationAt" DATETIME,
      "pendingDisconnectAt" DATETIME,
      "pendingDisconnectReason" TEXT,
      "newAccountsAvailableAt" DATETIME,
      "webhookUrl" TEXT
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InvestmentFlow" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "transactionId" TEXT
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "RecurringTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "anchorDay" INTEGER
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "TransactionRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "addTagId" TEXT
    )
  `);
}

describe("migration-health", () => {
  const prevDbUrl = process.env.DATABASE_URL;
  let tempDir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "migration-health-"));
    dbPath = path.join(tempDir, "test.db");
    process.env.DATABASE_URL = `file:${dbPath}`;
    prisma = prismaForFile(dbPath);
    await createMinimalSchema(prisma);
  });

  afterEach(async () => {
    process.env.DATABASE_URL = prevDbUrl;
    await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports schema ok when repair columns exist", async () => {
    const result = await checkSchemaColumnHealth(prisma);
    expect(result.status).toBe("ok");
    expect(result.missing).toEqual([]);
  });

  it("reports schema drift when columns are missing", async () => {
    await prisma.$executeRawUnsafe('DROP TABLE "Transaction"');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Transaction" ("id" TEXT NOT NULL PRIMARY KEY)
    `);

    const result = await checkSchemaColumnHealth(prisma);
    expect(result.status).toBe("drift");
    expect(result.missing).toContain("Transaction.preCreditCents");
  });

  it("reports oauth readable when values decrypt", async () => {
    await prisma.serverSetting.create({
      data: {
        key: "oauth.google.enabled",
        encryptedValue: encryptSecret("true"),
      },
    });

    const result = await checkOAuthDecryptHealth(prisma);
    expect(result.allReadable).toBe(true);
    expect(result.google).toBe("ok");
  });

  it("reports oauth decrypt failure with wrong key", async () => {
    const prevKey = process.env.SERVER_SETTINGS_ENCRYPTION_KEY;
    process.env.SERVER_SETTINGS_ENCRYPTION_KEY = "key-used-to-encrypt-settings-32ch";
    await prisma.serverSetting.create({
      data: {
        key: "oauth.google.clientId",
        encryptedValue: encryptSecret("client-id"),
      },
    });
    process.env.SERVER_SETTINGS_ENCRYPTION_KEY = "different-encryption-key-32chars";
    const result = await checkOAuthDecryptHealth(prisma);
    process.env.SERVER_SETTINGS_ENCRYPTION_KEY = prevKey;

    expect(result.allReadable).toBe(false);
    expect(result.google).toBe("decrypt_failed");
    expect(result.failedKeys).toContain("oauth.google.clientId");
  });

  it("reads repair marker from ServerSetting", async () => {
    const at = "2026-05-15T12:00:00.000Z";
    await prisma.serverSetting.createMany({
      data: [
        { key: OPS_LAST_SCHEMA_REPAIR_AT, encryptedValue: at },
        { key: OPS_SCHEMA_REPAIR_VERSION, encryptedValue: "1" },
      ],
    });

    const marker = await getSchemaRepairMarker(prisma);
    expect(marker.ran).toBe(true);
    expect(marker.lastAt).toBe(at);
    expect(marker.version).toBe("1");
  });
});
