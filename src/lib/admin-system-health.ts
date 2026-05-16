import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { getLoginDebugVersionLine } from "@/lib/app-version";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { getMigrationHealth } from "@/lib/migration-health";

export type EnvPresence = "present" | "missing" | "invalid";

function envTrim(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function classifySecret(name: string, value: string, minLen: number): EnvPresence {
  if (!value) return "missing";
  if (value.length < minLen) return "invalid";
  return "present";
}

/** Safe display label for SQLite `file:` URLs (basename only; strips query string). */
export function summarizeDatabaseUrlDisplay(databaseUrl: string): { kind: "sqlite_file" | "other" | "missing"; label: string } {
  const raw = databaseUrl.trim();
  if (!raw) return { kind: "missing", label: "not configured" };
  if (!raw.startsWith("file:")) {
    return { kind: "other", label: "non-file database" };
  }
  const withoutScheme = raw.slice("file:".length).split("?")[0] ?? "";
  const base = path.basename(withoutScheme || "database");
  return { kind: "sqlite_file", label: base || "database" };
}

export type AdminSystemHealth = {
  appVersionLine: string;
  database: {
    reachable: boolean;
    providerLabel: string;
    urlSummary: ReturnType<typeof summarizeDatabaseUrlDisplay>;
  };
  migrationHealth: Awaited<ReturnType<typeof getMigrationHealth>>;
  env: {
    NEXTAUTH_SECRET: EnvPresence;
    SERVER_SETTINGS_ENCRYPTION_KEY: EnvPresence;
    NEXTAUTH_URL: EnvPresence;
  };
  authProviders: {
    credentialsRegistered: boolean;
    googleRuntime: boolean;
    authentikRuntime: boolean;
  };
};

export async function getAdminSystemHealth(prisma: PrismaClient): Promise<AdminSystemHealth> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const urlSummary = summarizeDatabaseUrlDisplay(databaseUrl);

  let reachable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    reachable = false;
  }

  const nextAuthSecret = envTrim("NEXTAUTH_SECRET");
  const encKey = envTrim("SERVER_SETTINGS_ENCRYPTION_KEY");
  const nextAuthUrl = envTrim("NEXTAUTH_URL");

  const [migrationHealth, googleProvider, authentikProvider] = await Promise.all([
    getMigrationHealth(prisma),
    getGoogleProvider(),
    getAuthentikProvider(),
  ]);

  return {
    appVersionLine: getLoginDebugVersionLine(),
    database: {
      reachable,
      providerLabel: urlSummary.kind === "sqlite_file" ? "sqlite (file)" : urlSummary.kind === "other" ? "other" : "unknown",
      urlSummary,
    },
    migrationHealth,
    env: {
      NEXTAUTH_SECRET: classifySecret("NEXTAUTH_SECRET", nextAuthSecret, 16),
      SERVER_SETTINGS_ENCRYPTION_KEY: classifySecret("SERVER_SETTINGS_ENCRYPTION_KEY", encKey, 32),
      NEXTAUTH_URL: nextAuthUrl ? (nextAuthUrl.startsWith("http") ? "present" : "invalid") : "missing",
    },
    authProviders: {
      credentialsRegistered: true,
      googleRuntime: googleProvider != null,
      authentikRuntime: authentikProvider != null,
    },
  };
}
