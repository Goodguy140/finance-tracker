import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/e2e/**"],
    globalSetup: ["./src/test-support/migrated-db.global-setup.ts"],
    // A test that asserts nothing passes whatever the code does. Fail it instead.
    expect: { requireAssertions: true },
  },
});
