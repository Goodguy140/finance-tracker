import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the app's plain TypeScript (no React Native): sign-in, addresses, formatting.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // A test that asserts nothing passes whatever the code does. Fail it instead.
    expect: { requireAssertions: true },
  },
});
