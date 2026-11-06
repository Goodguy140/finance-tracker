import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/lib/dashboard-layout/cards";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * What `GET /api/v1/spending` reads from a real database: the month's home-currency spending, the
 * month before it for the comparison, the budgets for the expected pace, savings transfers, and
 * the website card's settings.
 */

const dir = mkdtempSync(join(tmpdir(), "spending-api-"));
const url = `file:${join(dir, "spending.db")}`;
let db: PrismaClient;
let api: typeof import("./spending");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./spending");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

it("builds both charts from the month's home-currency spending, last month, the budgets and savings transfers", async () => {
  const user = await db.user.create({ data: { email: "spending@example.test", displayName: "Test", countryCode: "CA" } });
  const userId = user.id;
  const chequing = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
  const savings = await db.account.create({ data: { userId, name: "Savings", type: "SAVINGS", countsAsSavings: true } });
  const dollars = await db.account.create({ data: { userId, name: "US card", type: "CREDIT_CARD", currency: "USD", countryCode: "US" } });
  const groceries = await db.category.create({ data: { userId, name: "Groceries", kind: "EXPENSE" } });
  const dining = await db.category.create({ data: { userId, name: "Dining", kind: "EXPENSE" } });
  const spend = (ymd: string, amountCents: number, categoryId: string, accountId = chequing.id) =>
    db.transaction.create({ data: { userId, accountId, categoryId, type: "EXPENSE", amountCents, date: day(ymd) } });

  await spend("2026-11-02", 5_000, groceries.id);
  // Split between two categories: the pie counts the parts, the running total the whole.
  const split = await spend("2026-11-04", 3_000, groceries.id);
  await db.splitTransactionPart.createMany({
    data: [
      { userId, transactionId: split.id, categoryId: groceries.id, amountCents: 1_000 },
      { userId, transactionId: split.id, categoryId: dining.id, amountCents: 2_000 },
    ],
  });
  // Another currency stays out of every total, as on the dashboard.
  await spend("2026-11-03", 99_900, dining.id, dollars.id);
  // Last month, for the comparison line.
  await spend("2026-10-01", 2_000, groceries.id);
  await spend("2026-10-09", 10_000, dining.id);
  await db.budget.create({ data: { userId, categoryId: groceries.id, periodMonth: "2026-09", limitCents: 30_000 } });
  await db.transaction.create({
    data: { userId, accountId: chequing.id, transferAccountId: savings.id, categoryId: groceries.id, type: "TRANSFER", amountCents: 25_000, date: day("2026-11-05") },
  });
  await db.dashboardLayout.create({
    data: {
      userId,
      layoutJson: JSON.stringify({ ...DEFAULT_LAYOUT, settings: { "cumulative-spend": { compareWith: "last-month" } } }),
    },
  });

  const now = new Date("2026-11-10T15:00:00Z");
  const data = await api.loadAppSpending(user, "2026-11", {}, now);

  expect(data).toMatchObject({ month: "2026-11", today: "2026-11-10", currency: "CAD", compareWith: "last-month", showSavings: false });
  expect(data.cumulative.days).toHaveLength(30);
  expect(data.cumulative.days[3]).toMatchObject({ totalCents: 8_000, comparisonCents: 2_000 });
  // The September budget still holds in November: 30,000 over 30 days is 10,000 by the 10th.
  expect(data.cumulative).toMatchObject({ totalCents: 8_000, expectedBasis: "budgets", expectedGapCents: -2_000, comparisonGapCents: -4_000 });
  expect(data.categories.slices.map(({ name, cents, kind }) => ({ name, cents, kind }))).toEqual([
    { name: "Groceries", cents: 6_000, kind: "category" },
    { name: "Dining", cents: 2_000, kind: "category" },
  ]);
  expect(data.categories.savings).toBeNull();

  // The phone's own picks win over the card's.
  const picked = await api.loadAppSpending(user, "2026-11", { compareWith: "none", showSavings: true }, now);
  expect(picked.cumulative.comparisonGapCents).toBeNull();
  expect(picked.cumulative.days.every((d) => d.comparisonCents === null)).toBe(true);
  expect(picked.categories.savings).toEqual({ cents: 25_000, accounts: 1 });
  expect(picked.categories.slices.at(-1)).toMatchObject({ name: "Savings", cents: 25_000, kind: "savings" });
});
