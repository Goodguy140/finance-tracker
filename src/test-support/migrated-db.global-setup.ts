import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import type {} from "./migrated-db";

/**
 * Applies the migrations once per run and hands the file to every test that needs a real
 * database (`copyMigratedDatabase`). Each of those files used to run `prisma migrate deploy`
 * itself, which is ~1.4s of process start-up apiece for an identical result.
 */
export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "migrated-db-template-"));
  const file = join(dir, "template.db");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${file}` },
    stdio: "ignore",
  });
  project.provide("migratedDbTemplate", file);
  return () => rmSync(dir, { recursive: true, force: true });
}
