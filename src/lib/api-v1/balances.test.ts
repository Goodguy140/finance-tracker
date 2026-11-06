import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The phone's hand-entered balances, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-balances-"));
const url = `file:${join(dir, "balances.db")}`;
let db: PrismaClient;
let api: typeof import("./balances");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./balances");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `bal${seq}@example.test`, displayName: "Test" } })).id;
  accountId = (await db.account.create({ data: { userId, name: "Cash", type: "CASH" } })).id;
});

function readings() {
  return db.accountBalanceSnapshot.findMany({ where: { accountId }, orderBy: { date: "asc" }, select: { balanceCents: true, source: true } });
}

describe("parseBalanceBody", () => {
  it("takes whole cents and a real day no later than today", () => {
    expect(api.parseBalanceBody({ balanceCents: -1250, date: "2026-11-06" }, "2026-11-06")).toEqual({
      ok: true,
      value: { balanceCents: -1250, date: "2026-11-06" },
    });
    expect(api.parseBalanceBody({ balanceCents: 12.5, date: "2026-11-06" }, "2026-11-06").ok).toBe(false);
    expect(api.parseBalanceBody({ balanceCents: 100, date: "2026-02-30" }, "2026-11-06")).toEqual({ ok: false, error: "That date does not exist." });
    expect(api.parseBalanceBody({ balanceCents: 100, date: "2026-11-07" }, "2026-11-06")).toEqual({
      ok: false,
      error: "A balance can't be dated after today.",
    });
  });
});

describe("recordManualBalance", () => {
  it("stores the person's own reading, and a second one that day replaces the first", async () => {
    expect(await api.recordManualBalance(db, userId, accountId, { balanceCents: 5_000, date: "2026-11-01" })).toBe("recorded");
    expect(await api.recordManualBalance(db, userId, accountId, { balanceCents: 7_500, date: "2026-11-01" })).toBe("recorded");
    expect(await readings()).toEqual([{ balanceCents: 7_500, source: "MANUAL" }]);
  });

  it("refuses another person's account and an archived one", async () => {
    const other = (await db.user.create({ data: { email: `bal-other${seq}@example.test`, displayName: "Other" } })).id;
    expect(await api.recordManualBalance(db, other, accountId, { balanceCents: 100, date: "2026-11-01" })).toBe("not_found");
    await db.account.update({ where: { id: accountId }, data: { archived: true } });
    expect(await api.recordManualBalance(db, userId, accountId, { balanceCents: 100, date: "2026-11-01" })).toBe("archived");
    expect(await readings()).toEqual([]);
  });
});

describe("manual balances", () => {
  it("lists only the person's own entries, newest first, and deletes only those", async () => {
    const day = (d: number) => new Date(Date.UTC(2026, 9, d));
    const old = await db.accountBalanceSnapshot.create({ data: { userId, accountId, date: day(1), balanceCents: 100, source: "MANUAL" } });
    const bank = await db.accountBalanceSnapshot.create({ data: { userId, accountId, date: day(2), balanceCents: 200, source: "PLAID" } });
    await db.accountBalanceSnapshot.create({ data: { userId, accountId, date: day(3), balanceCents: 300, source: "MANUAL" } });

    expect((await api.loadManualBalances(db, userId, accountId)).map((b) => [b.date, b.cents])).toEqual([
      ["2026-10-03", 300],
      ["2026-10-01", 100],
    ]);
    expect(await api.deleteManualBalance(db, userId, accountId, bank.id)).toBe(false);
    expect(await api.deleteManualBalance(db, "someone-else", accountId, old.id)).toBe(false);
    expect(await api.deleteManualBalance(db, userId, accountId, old.id)).toBe(true);
    expect((await readings()).map((r) => r.balanceCents)).toEqual([200, 300]);
  });
});
