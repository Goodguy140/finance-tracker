import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveE2eDatabase } = require("../../scripts/e2e-database.cjs") as {
  resolveE2eDatabase: (
    root: string,
    env: Record<string, string | undefined>,
  ) => { url: string; filePath: string };
};

const root = path.resolve("/repo");
const dataDir = path.join(root, ".data");

describe("resolveE2eDatabase", () => {
  it("defaults to .data/e2e.db with an absolute URL", () => {
    const { filePath, url } = resolveE2eDatabase(root, {});
    expect(filePath).toBe(path.join(dataDir, "e2e.db"));
    expect(url).toBe(`file:${filePath.replace(/\\/g, "/")}`);
  });

  it("ignores DATABASE_URL, which may name the developer's real database", () => {
    const { filePath } = resolveE2eDatabase(root, { DATABASE_URL: "file:./prisma/dev.db" });
    expect(filePath).toBe(path.join(dataDir, "e2e.db"));
  });

  it("accepts relative and absolute E2E_DATABASE_URL inside .data/", () => {
    expect(resolveE2eDatabase(root, { E2E_DATABASE_URL: "file:./.data/other.db" }).filePath).toBe(
      path.join(dataDir, "other.db"),
    );
    const abs = path.join(dataDir, "nested", "x.db");
    expect(resolveE2eDatabase(root, { E2E_DATABASE_URL: `file:${abs}?mode=rw` }).filePath).toBe(abs);
  });

  it.each([
    "file:./prisma/dev.db",
    "file:./dev.db",
    "file:./.data/../prisma/dev.db",
    "file:./.data",
    "file:/data/app.db",
    "file:./.database/e2e.db",
    "postgresql://localhost/finance",
  ])("refuses %s, which the launcher would delete", (url) => {
    expect(() => resolveE2eDatabase(root, { E2E_DATABASE_URL: url })).toThrow(/E2E_DATABASE_URL/);
  });
});
