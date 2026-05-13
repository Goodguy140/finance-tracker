import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3050",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && PORT=3050 npm run start",
    url: "http://127.0.0.1:3050/login",
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXTAUTH_URL: "http://127.0.0.1:3050",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
