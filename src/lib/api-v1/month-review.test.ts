import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The monthly review for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-month-review-"));
const url = `file:${join(dir, "review.db")}`;
let db: PrismaClient;
let api: typeof import("./month-review");
let data: typeof import("@/lib/reports/month-review-data");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./month-review");
  data = await import("@/lib/reports/month-review-data");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };
let food: string;
let fun: string;
let pay: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `review${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  food = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE", rolloverSinceMonth: "2026-01" } })).id;
  fun = (await db.category.create({ data: { userId: user.id, name: "Fun", kind: "EXPENSE" } })).id;
  pay = (await db.category.create({ data: { userId: user.id, name: "Pay", kind: "INCOME" } })).id;
});

function entry(categoryId: string, type: "EXPENSE" | "INCOME", amountCents: number, day: string, extra: Record<string, unknown> = {}) {
  return db.transaction.create({ data: { userId: user.id, categoryId, type, amountCents, date: new Date(`${day}T00:00:00Z`), title: "Row", ...extra } });
}

describe("the monthly review", () => {
  it("gives the month's totals against the month before, its budgets, what wants a look, and whether it is closed", async () => {
    await entry(pay, "INCOME", 300_000, "2026-09-01");
    await entry(food, "EXPENSE", 60_000, "2026-09-10", { needsReview: true });
    await entry(fun, "EXPENSE", 10_000, "2026-09-12");
    await entry(food, "EXPENSE", 40_000, "2026-08-10");
    await db.budget.create({ data: { userId: user.id, categoryId: food, periodMonth: "2026-09", limitCents: 50_000 } });
    await db.budget.create({ data: { userId: user.id, categoryId: fun, periodMonth: "2026-09", limitCents: 20_000 } });

    const review = api.serializeMonthReview(await data.loadMonthReview(user, "2026-09", db));
    expect(review).toMatchObject({
      month: "2026-09",
      running: false,
      currency: "CAD",
      incomeCents: 300_000,
      spendingCents: 70_000,
      netCents: 230_000,
      previousSpendingCents: 40_000,
      transactionCount: 3,
      budgetsKept: 1,
      entriesNeedingReview: 1,
      bankRowsWaiting: 0,
      closedOn: null,
    });
    // Over budget first; only Food rolls over.
    expect(review.budgets).toEqual([
      { categoryName: "Food", spentCents: 60_000, limitCents: 50_000, rollsOver: true },
      { categoryName: "Fun", spentCents: 10_000, limitCents: 20_000, rollsOver: false },
    ]);
    expect(review.changes).toEqual([
      { categoryName: "Food", cents: 60_000, previousCents: 40_000 },
      { categoryName: "Fun", cents: 10_000, previousCents: 0 },
    ]);

    await data.closeMonth(db, user.id, "2026-09");
    await data.closeMonth(db, user.id, "2026-09");
    expect(api.serializeMonthReview(await data.loadMonthReview(user, "2026-09", db)).closedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await data.reopenMonth(db, user.id, "2026-09");
    expect(api.serializeMonthReview(await data.loadMonthReview(user, "2026-09", db)).closedOn).toBeNull();
  });

  it("reviews the month just finished when none, or a later one, is asked for", () => {
    const { ym, currentYm } = data.reviewMonth("2999-01", "UTC");
    expect(ym < currentYm).toBe(true);
    expect(data.reviewMonth(null, "UTC").ym).toBe(ym);
    expect(data.reviewMonth("2026-02", "UTC").ym).toBe("2026-02");
  });

  it("closes only a month that has started", () => {
    expect(api.parseCloseBody({ month: "2026-10", closed: true }, "2026-11")).toEqual({ ok: true, month: "2026-10", closed: true });
    expect(api.parseCloseBody({ month: "2026-12", closed: true }, "2026-11")).toMatchObject({ ok: false });
    expect(api.parseCloseBody({ month: "2026-13", closed: true }, "2026-11")).toMatchObject({ ok: false });
  });
});
