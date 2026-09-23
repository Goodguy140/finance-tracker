import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_PAGES_CACHE } from "./pwa-cache";
import { SAVED_COPY_META } from "./use-online-status";

describe("PRIVATE_PAGES_CACHE", () => {
  it("names the cache the service worker stores the dashboard in", () => {
    // sw.js is plain JS served from public/ and cannot import this module. If the two
    // names drift, sign-out purges a cache that no longer exists and the data stays.
    const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    const version = sw.match(/const VERSION = "([^"]+)";/)?.[1];
    const privateName = sw.match(/const PRIVATE_CACHE = `([^`]+)`;/)?.[1]?.replace("${VERSION}", version ?? "");
    expect(privateName).toBe(PRIVATE_PAGES_CACHE);
  });

  it("tags saved copies with the meta the page checks before allowing writes", () => {
    // If this drifts, a saved copy served on a connection that goes nowhere looks live
    // and offers forms that cannot save.
    const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain(`<meta name="${SAVED_COPY_META}" content="1">`);
  });
});
