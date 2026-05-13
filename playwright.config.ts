import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3050";

/**
 * `webServer` runs `next start` (NODE_ENV=production). Middleware and auth require
 * NEXTAUTH_SECRET and SERVER_SETTINGS_ENCRYPTION_KEY; merge parent env and supply
 * safe local-only defaults when unset so `npm run test:e2e` works without a .env.
 * CI should still set real secrets via the environment when available.
 */
function webServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.NEXTAUTH_URL = baseURL;
  env.NEXTAUTH_SECRET =
    process.env.NEXTAUTH_SECRET?.trim() ||
    "e2e-default-nextauth-secret-minimum-32-characters-not-for-production";
  env.SERVER_SETTINGS_ENCRYPTION_KEY =
    process.env.SERVER_SETTINGS_ENCRYPTION_KEY?.trim() ||
    "e2e-default-server-settings-encryption-key-32ch";
  env.DATABASE_URL = process.env.DATABASE_URL?.trim() || "file:./prisma/dev.db";
  env.AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST?.trim() || "true";
  return env;
}

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
    command: "npm run build && PORT=3050 npm run start",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: webServerEnv(),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
