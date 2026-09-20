import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// `localhost`, not 127.0.0.1: Chromium refuses an IP literal as a WebAuthn RP ID, and
// NEXTAUTH_URL (below) is what the passkey RP ID is derived from.
const baseURL = "http://localhost:3050";
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
  // Every spec signs in from the same socket, so the whole suite shares one per-IP login
  // budget; at the default of 30 the last few logins of a run fail with a lockout.
  env.LOGIN_MAX_PER_IP = process.env.LOGIN_MAX_PER_IP?.trim() || "1000";
  // Blanked, not inherited: a developer's own `.env` usually holds real Plaid credentials,
  // and a complete PLAID_CLIENT_ID/PLAID_SECRET pair overrides whatever the admin UI stores.
  // The suite exercises the stored-credentials path, so it must not depend on what happens
  // to be in the environment — and no spec should ever be able to call Plaid for real.
  env.PLAID_CLIENT_ID = "";
  env.PLAID_SECRET = "";
  env.PLAID_ENV = "";
  // Swaps in the deterministic in-memory Plaid, so the link/mapping/unlink flows run
  // against a real browser and database without a Plaid account — and so no spec can
  // reach the live API even if credentials leak into the environment some other way.
  env.PLAID_FAKE_CLIENT = "1";
  // The background sweep is started by instrumentation.ts 45s after boot and syncs every
  // due bank for every user. A full two-project run lasts longer than that, so it would
  // fire mid-suite, take a spec's sync lock and advance its cursor — which is exactly the
  // kind of intermittent failure that is miserable to chase. The sweep itself is covered
  // directly by plaid-sync-sweep.spec.ts, which calls it scoped to its own user.
  env.PLAID_SYNC_SCHEDULER = "false";
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
