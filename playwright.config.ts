import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3050";
const repoRoot = process.cwd();

const DEFAULT_NEXTAUTH_SECRET =
  "e2e-default-nextauth-secret-minimum-32-characters-not-for-production";
const DEFAULT_SERVER_SETTINGS_KEY =
  "e2e-default-server-settings-encryption-key-32ch";

function absolutizeSqliteUrl(url: string, cwd: string): string {
  const t = url.trim();
  if (!t.startsWith("file:")) return t;
  const rest = t.slice("file:".length);
  if (rest.startsWith("/") && !rest.startsWith("//")) return t.replace(/\\/g, "/");
  if (rest.startsWith("//")) return t.replace(/\\/g, "/");
  return `file:${path.resolve(cwd, rest)}`.replace(/\\/g, "/");
}

function resolveE2eDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    return `file:${path.join(repoRoot, ".data", "e2e.db")}`.replace(/\\/g, "/");
  }
  return absolutizeSqliteUrl(raw, repoRoot);
}

/**
 * Shared env for Playwright workers (Prisma in tests) and the webServer child.
 * Keeps SERVER_SETTINGS_ENCRYPTION_KEY aligned so encryptSecret in tests matches the server.
 */
function getE2eEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.DATABASE_URL = resolveE2eDatabaseUrl();
  env.NEXTAUTH_URL = baseURL;
  env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET?.trim() || DEFAULT_NEXTAUTH_SECRET;
  env.SERVER_SETTINGS_ENCRYPTION_KEY =
    process.env.SERVER_SETTINGS_ENCRYPTION_KEY?.trim() || DEFAULT_SERVER_SETTINGS_KEY;
  env.AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST?.trim() || "true";
  return env;
}

// Test workers import Prisma / encryptSecret — align with webServer before modules load.
for (const [k, v] of Object.entries(getE2eEnv())) {
  if (!process.env[k]?.trim()) process.env[k] = v;
}
process.env.DATABASE_URL = resolveE2eDatabaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run e2e:web-server",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: getE2eEnv(),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
