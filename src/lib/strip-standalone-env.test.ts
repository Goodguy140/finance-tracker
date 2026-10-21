import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { stripStandaloneEnv } = require("../../scripts/strip-standalone-env.cjs") as {
  stripStandaloneEnv: (dir: string) => string[];
};

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("stripStandaloneEnv", () => {
  it("removes the .env files next build copied and leaves the server alone", () => {
    dir = mkdtempSync(path.join(tmpdir(), "standalone-"));
    for (const name of [".env", ".env.production", "server.js", "package.json"]) {
      writeFileSync(path.join(dir, name), "x");
    }
    mkdirSync(path.join(dir, ".next"));

    expect(stripStandaloneEnv(dir).map((f) => path.basename(f)).sort()).toEqual([".env", ".env.production"]);
    expect(existsSync(path.join(dir, ".env"))).toBe(false);
    expect(existsSync(path.join(dir, ".env.production"))).toBe(false);
    expect(existsSync(path.join(dir, "server.js"))).toBe(true);
    expect(existsSync(path.join(dir, ".next"))).toBe(true);
  });

  it("does nothing when there is no standalone build", () => {
    dir = mkdtempSync(path.join(tmpdir(), "standalone-"));
    expect(stripStandaloneEnv(path.join(dir, "missing"))).toEqual([]);
  });
});
