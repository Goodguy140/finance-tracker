import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Replaying every migration must reproduce `schema.prisma` exactly.
 *
 * This repo has been bitten twice by the same class of bug, both invisible until someone
 * went looking:
 *
 *  - `20260504002823` rebuilt `Transaction` and forgot the two columns the migration
 *    immediately before it had just added, silently dropping them and any stored values;
 *  - `20260511120000` added `User.defaultExpenseAccountId` as a bare TEXT column, so the
 *    `onDelete: SetNull` the datamodel declares was enforced on no database anywhere.
 *
 * Neither surfaced in normal use: the first was patched over at runtime by
 * `scripts/repair-sqlite-schema.cjs`, and the second only shows up as a dangling id after
 * an account is deleted. A drifted migration history is exactly the kind of thing that is
 * cheap to catch here and expensive to discover in production, so assert it directly.
 *
 * Fails loudly with the SQL Prisma would need to close the gap, which is usually also the
 * fix — either as a new migration, or by correcting the one that got it wrong.
 */
const shadowDir = mkdtempSync(join(tmpdir(), "prisma-migration-drift-"));

afterAll(() => {
  rmSync(shadowDir, { recursive: true, force: true });
});

describe("migration history", () => {
  it("replays into exactly the schema the datamodel declares", () => {
    const shadowUrl = `file:${join(shadowDir, "shadow.db")}`;

    const diff = execFileSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--shadow-database-url",
        shadowUrl,
        "--script",
      ],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    // Prisma prints this exact sentence when the two sides already agree.
    expect(
      diff.includes("This is an empty migration."),
      `Migration history has drifted from prisma/schema.prisma.\n\n` +
        `Prisma would need the following to reconcile them — add it as a new migration, ` +
        `or fix the migration that introduced the gap:\n\n${diff}`,
    ).toBe(true);
  }, 120_000);
});
