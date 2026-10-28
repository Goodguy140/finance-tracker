import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentYmInTimeZone } from "@/lib/period-month";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** "Suggest budgets" sets the ticked amounts from this month on, and only on the user's own categories. */

const dir = mkdtempSync(join(tmpdir(), "budget-suggestions-"));
const url = `file:${join(dir, "budget-suggestions.db")}`;
let db: PrismaClient;
let actions: typeof import("./budgets");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId, timezone: "America/Toronto" })),
}));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./budgets");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
const newUser = async () => (await db.user.create({ data: { email: `b${seq++}@example.test`, displayName: "Test" } })).id;

beforeEach(async () => {
  session.userId = await newUser();
});

const apply = (rows: Array<{ categoryId: string; limitCents: number }>) => {
  const data = new FormData();
  data.set("budgets", JSON.stringify(rows));
  return actions.applyBudgetSuggestionsAction(data);
};

describe("applyBudgetSuggestionsAction", () => {
  it("sets this month's budgets, leaving an earlier month's as it was and keeping the label", async () => {
    const food = await db.category.create({ data: { userId: session.userId, name: "Food", kind: "EXPENSE" } });
    const fun = await db.category.create({ data: { userId: session.userId, name: "Fun", kind: "EXPENSE" } });
    await db.budget.create({
      data: { userId: session.userId, categoryId: food.id, periodMonth: "2025-01", limitCents: 300_00, name: "Groceries" },
    });

    expect(await apply([{ categoryId: food.id, limitCents: 420_00 }, { categoryId: fun.id, limitCents: 30_00 }])).toBeUndefined();

    const ym = currentYmInTimeZone("America/Toronto");
    const rows = await db.budget.findMany({
      where: { userId: session.userId },
      orderBy: [{ categoryId: "asc" }, { periodMonth: "asc" }],
      select: { categoryId: true, periodMonth: true, limitCents: true, name: true },
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { categoryId: food.id, periodMonth: "2025-01", limitCents: 300_00, name: "Groceries" },
        { categoryId: food.id, periodMonth: ym, limitCents: 420_00, name: "Groceries" },
        { categoryId: fun.id, periodMonth: ym, limitCents: 30_00, name: null },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("refuses another user's category and an income category, setting nothing", async () => {
    const other = await newUser();
    const theirs = await db.category.create({ data: { userId: other, name: "Food", kind: "EXPENSE" } });
    const salary = await db.category.create({ data: { userId: session.userId, name: "Salary", kind: "INCOME" } });
    const mine = await db.category.create({ data: { userId: session.userId, name: "Fun", kind: "EXPENSE" } });

    for (const categoryId of [theirs.id, salary.id]) {
      expect(await apply([{ categoryId: mine.id, limitCents: 10_00 }, { categoryId, limitCents: 10_00 }])).toMatchObject({ ok: false });
    }
    expect(await db.budget.count({ where: { userId: { in: [session.userId, other] } } })).toBe(0);
  });
});
