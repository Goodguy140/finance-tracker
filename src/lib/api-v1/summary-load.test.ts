import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * What `GET /api/v1/summary` reads for the Home screen's top card: Safe to spend always, and
 * zero-based budgeting's "To assign" only for someone who budgets that way.
 */

const dir = mkdtempSync(join(tmpdir(), "summary-api-"));
const url = `file:${join(dir, "summary.db")}`;
let db: PrismaClient;
let api: typeof import("./summary");

beforeAll(async () => {
  copyMigratedDatabase(url);
  // Savings goals load through the app's shared client, which reads DATABASE_URL when first loaded.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./summary");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const now = new Date("2026-11-16T15:00:00Z");

it("adds To assign from this month's income and budgets only when zero-based budgeting is on", async () => {
  const user = await db.user.create({ data: { email: "summary@example.test", displayName: "Test", countryCode: "CA" } });
  const userId = user.id;
  const salary = await db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } });
  const groceries = await db.category.create({ data: { userId, name: "Groceries", kind: "EXPENSE" } });
  await db.transaction.create({
    data: { userId, type: "INCOME", amountCents: 300_000, date: new Date("2026-11-01T00:00:00Z"), categoryId: salary.id },
  });
  await db.transaction.create({
    data: { userId, type: "EXPENSE", amountCents: 60_000, date: new Date("2026-11-10T00:00:00Z"), categoryId: groceries.id },
  });
  await db.budget.create({ data: { userId, categoryId: groceries.id, periodMonth: "2026-11", limitCents: 50_000 } });

  expect((await api.loadAppSummary(user, now, db)).zeroBased).toBeNull();

  await db.user.update({ where: { id: userId }, data: { zeroBasedBudgeting: true } });
  const summary = await api.loadAppSummary(user, now, db);
  expect(summary.zeroBased).toMatchObject({
    incomeCents: 300_000,
    assignedCents: 50_000,
    toAssignCents: 250_000,
    overspent: [{ categoryId: groceries.id, categoryName: "Groceries", overCents: 10_000 }],
  });
  // Safe to spend is still there for the widgets, worked out from the same month.
  expect(summary.safeToSpend.incomeReceivedCents).toBe(300_000);
});
