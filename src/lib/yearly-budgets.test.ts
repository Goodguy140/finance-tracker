import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "yearly-budgets-"));
const url = `file:${join(dir, "yearly.db")}`;
let db: PrismaClient;
let yearly: typeof import("./yearly-budgets");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  yearly = await import("./yearly-budgets");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("sinking fund maths", () => {
  it("sets a twelfth aside each month and lets spending draw it down", () => {
    // $1,200 a year, nothing spent by the end of October: $1,000 waiting.
    expect(yearly.sinkingFundStatus(120_000, 0, 10)).toEqual({
      monthlyCents: 10_000,
      setAsideCents: 100_000,
      spentCents: 0,
      fundCents: 100_000,
      leftForYearCents: 120_000,
    });
    // The whole bill paid in March: spent ahead of the fund, nothing left for the year.
    expect(yearly.sinkingFundStatus(120_000, 120_000, 3)).toMatchObject({ fundCents: -90_000, leftForYearCents: 0 });
  });

  it("uses the latest year on or before the one shown", () => {
    const rows = [
      { categoryId: "a", year: 2025, limitCents: 1 },
      { categoryId: "a", year: 2026, limitCents: 2 },
      { categoryId: "a", year: 2027, limitCents: 3 },
      { categoryId: "b", year: 2024, limitCents: 4 },
    ];
    const active = yearly.selectActiveYearlyBudgets(rows, 2026);
    expect(active.get("a")?.limitCents).toBe(2);
    expect(active.get("b")?.limitCents).toBe(4);
  });
});

let seq = 0;
let userId: string;
let insuranceId: string;
let otherId: string;
let cadId: string;
let usdId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `y${seq}@example.test`, displayName: "Test" } })).id;
  insuranceId = (await db.category.create({ data: { userId, name: "Insurance", kind: "EXPENSE" } })).id;
  otherId = (await db.category.create({ data: { userId, name: "Other", kind: "EXPENSE" } })).id;
  cadId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
  usdId = (await db.account.create({ data: { userId, name: "US", type: "CHEQUING", currency: "USD" } })).id;
});

function expense(day: string, amountCents: number, extra: Record<string, unknown> = {}) {
  return db.transaction.create({
    data: { userId, accountId: cadId, categoryId: insuranceId, type: "EXPENSE", amountCents, title: "x", date: new Date(`${day}T00:00:00Z`), ...extra },
  });
}

describe("loading yearly budgets", () => {
  it("counts this year's home-currency spending through the month shown, split parts included", async () => {
    await db.yearlyBudget.create({ data: { userId, categoryId: insuranceId, year: 2025, limitCents: 120_000 } });
    await expense("2026-02-10", 30_000);
    await expense("2025-12-31", 99_999); // last year
    await expense("2026-11-01", 99_999); // after the month shown
    await expense("2026-03-01", 99_999, { accountId: usdId }); // another currency
    const split = await expense("2026-04-04", 10_000, { categoryId: otherId });
    await db.splitTransactionPart.createMany({
      data: [
        { userId, transactionId: split.id, categoryId: insuranceId, amountCents: 6_000 },
        { userId, transactionId: split.id, categoryId: otherId, amountCents: 4_000 },
      ],
    });

    // The 2025 budget carries into 2026.
    const rows = await yearly.loadYearlyBudgetRows(userId, "2026-10", "CAD");
    expect(rows).toEqual([
      expect.objectContaining({
        categoryName: "Insurance",
        limitCents: 120_000,
        spentCents: 36_000,
        setAsideCents: 100_000,
        fundCents: 64_000,
        leftForYearCents: 84_000,
      }),
    ]);
  });

  it("returns nothing without a yearly budget", async () => {
    await expense("2026-02-10", 30_000);
    expect(await yearly.loadYearlyBudgetRows(userId, "2026-10", "CAD")).toEqual([]);
  });
});
