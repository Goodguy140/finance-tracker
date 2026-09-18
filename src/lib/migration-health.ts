import type { PrismaClient } from "@prisma/client";
import { tryDecryptSecret } from "./security";

export const SCHEMA_REPAIR_VERSION = "3";

export const OPS_LAST_SCHEMA_REPAIR_AT = "ops.lastSchemaRepairAt";
export const OPS_SCHEMA_REPAIR_VERSION = "ops.schemaRepairVersion";

/** Columns added by scripts/repair-sqlite-schema-lib.cjs — keep in sync. */
export const REQUIRED_SCHEMA_COLUMNS = [
  { table: "Transaction", column: "preCreditCents" },
  { table: "Transaction", column: "creditCents" },
  { table: "Transaction", column: "creditBreakdownJson" },
  { table: "User", column: "defaultExpenseAccountId" },
  { table: "Account", column: "archived" },
  { table: "User", column: "tokenVersion" },
  { table: "User", column: "budgetAlertEmailEnabled" },
  { table: "User", column: "disabledAt" },
] as const;

const OAUTH_KEY_PREFIX = "oauth.";

export type OAuthProviderHealth = "not_configured" | "ok" | "decrypt_failed";

/** @deprecated Use `tryDecryptSecret` from `@/lib/security` directly. */
export const tryDecryptServerSetting = tryDecryptSecret;

async function tableColumns(prisma: PrismaClient, table: string): Promise<Set<string>> {
  const rows = (await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function isSqliteFileDb(): boolean {
  return (process.env.DATABASE_URL ?? "").trim().startsWith("file:");
}

export async function checkSchemaColumnHealth(prisma: PrismaClient) {
  if (!isSqliteFileDb()) {
    return { status: "skipped" as const, missing: [] as string[] };
  }

  const missing: string[] = [];
  for (const { table, column } of REQUIRED_SCHEMA_COLUMNS) {
    const columns = await tableColumns(prisma, table);
    if (!columns.has(column)) {
      missing.push(`${table}.${column}`);
    }
  }

  return missing.length === 0
    ? { status: "ok" as const, missing }
    : { status: "drift" as const, missing };
}

export async function getSchemaRepairMarker(prisma: PrismaClient) {
  const [lastAtRow, versionRow] = await Promise.all([
    prisma.serverSetting.findUnique({ where: { key: OPS_LAST_SCHEMA_REPAIR_AT } }),
    prisma.serverSetting.findUnique({ where: { key: OPS_SCHEMA_REPAIR_VERSION } }),
  ]);

  return {
    ran: Boolean(lastAtRow),
    lastAt: lastAtRow?.encryptedValue ?? null,
    version: versionRow?.encryptedValue ?? null,
  };
}

function providerHealthForKeys(
  keys: string[],
  failedKeys: Set<string>,
): OAuthProviderHealth {
  if (keys.length === 0) return "not_configured";
  return keys.some((key) => failedKeys.has(key)) ? "decrypt_failed" : "ok";
}

export async function checkOAuthDecryptHealth(prisma: PrismaClient) {
  const rows = await prisma.serverSetting.findMany({
    where: { key: { startsWith: OAUTH_KEY_PREFIX } },
  });

  const failedKeys = new Set<string>();
  for (const row of rows) {
    if (tryDecryptServerSetting(row.encryptedValue) === null && row.encryptedValue) {
      failedKeys.add(row.key);
    }
  }

  const googleKeys = rows.filter((row) => row.key.startsWith("oauth.google.")).map((row) => row.key);
  const authentikKeys = rows
    .filter((row) => row.key.startsWith("oauth.authentik."))
    .map((row) => row.key);

  const google = providerHealthForKeys(googleKeys, failedKeys);
  const authentik = providerHealthForKeys(authentikKeys, failedKeys);

  const configuredProviders = [google, authentik].filter((status) => status !== "not_configured");
  const allReadable =
    configuredProviders.length === 0 ||
    configuredProviders.every((status) => status === "ok");

  return {
    allReadable,
    failedKeys: [...failedKeys],
    google,
    authentik,
    hasAnyStored: rows.length > 0,
  };
}

export async function getMigrationHealth(prisma: PrismaClient) {
  const [schema, oauth, repair] = await Promise.all([
    checkSchemaColumnHealth(prisma),
    checkOAuthDecryptHealth(prisma),
    getSchemaRepairMarker(prisma),
  ]);

  return { schema, oauth, repair };
}
