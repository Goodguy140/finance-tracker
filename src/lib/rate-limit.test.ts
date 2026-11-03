import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Against a real SQLite file, because the failure this guards against was SQLite's: the limiter
 * read the counter and then wrote it inside one transaction, so a handful of simultaneous
 * requests (the phone app refreshing its screens after a change) waited on each other's locks
 * until they failed, and the API reported every such failure as "Rate limit exceeded".
 */

const dir = mkdtempSync(join(tmpdir(), "rate-limit-"));
const url = `file:${join(dir, "rate-limit.db")}`;
let db: PrismaClient;
let limiter: typeof import("./rate-limit");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  limiter = await import("./rate-limit");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const limit = (key: string, max = 3) => limiter.enforceSlidingWindowRateLimit(key, max, 60_000, "Too many");

describe("enforceSlidingWindowRateLimit", () => {
  it("lets the window's allowance through, then refuses with its own error", async () => {
    for (let i = 0; i < 3; i++) await limit("sequential");
    const refused = limit("sequential");
    await expect(refused).rejects.toBeInstanceOf(limiter.RateLimitExceededError);
    await expect(refused).rejects.toThrow("Too many");
  });

  it("starts a new window once the old one has closed", async () => {
    for (let i = 0; i < 3; i++) await limit("expiring");
    await expect(limit("expiring")).rejects.toBeInstanceOf(limiter.RateLimitExceededError);
    await db.rateLimitEntry.update({ where: { key: "expiring" }, data: { resetAt: new Date(Date.now() - 1) } });
    await expect(limit("expiring")).resolves.toBeUndefined();
    expect(await db.rateLimitEntry.findUnique({ where: { key: "expiring" } })).toMatchObject({ count: 1 });
  });

  it("counts simultaneous requests exactly, and none fails for any other reason", async () => {
    const burst = await Promise.allSettled(Array.from({ length: 20 }, () => limit("burst", 5)));
    expect(burst.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    for (const r of burst.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(limiter.RateLimitExceededError);
    }

    // The phone's refresh after a change: one request per screen, all at once, several times.
    for (let round = 0; round < 3; round++) {
      const screens = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => limit(`screen-${i}`, 60)));
      expect(screens.filter((r) => r.status === "rejected")).toEqual([]);
    }
  });
});
