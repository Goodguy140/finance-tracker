import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { fileHabitSeparately, habitMerchants } from "./track-habit";

const dir = mkdtempSync(join(tmpdir(), "track-habit-"));
const url = `file:${join(dir, "habit.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let userId: string;
let groceriesId: string;
let seq = 0;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `h${seq}@example.test`, displayName: "Test" } })).id;
  groceriesId = (await db.category.create({ data: { userId, name: "Groceries", kind: "EXPENSE" } })).id;
  await db.transactionRule.create({ data: { userId, priority: 0, titleOperator: "CONTAINS", titlePattern: "LCBO", setCategoryId: groceriesId } });
});

describe("fileHabitSeparately", () => {
  it("adds a category and a rule per merchant ahead of the older rules", async () => {
    const tracked = await fileHabitSeparately(db, userId, "ALCOHOL", ["LCBO", "Beer Store", "LCBO"]);
    expect(tracked).toMatchObject({ categoryName: "Alcohol", rulesAdded: 2 });
    const rules = await db.transactionRule.findMany({ where: { userId }, orderBy: { priority: "asc" } });
    // Short names start the title, so "LCBO" never fires inside another word.
    expect(rules.map((r) => [r.priority, r.titleOperator, r.titlePattern, r.setCategoryId])).toEqual([
      [0, "STARTS_WITH", "LCBO", tracked.categoryId],
      [1, "CONTAINS", "Beer Store", tracked.categoryId],
      [2, "CONTAINS", "LCBO", groceriesId],
    ]);
  });

  it("adds nothing twice, and reuses the category the first time made", async () => {
    const first = await fileHabitSeparately(db, userId, "ALCOHOL", ["Beer Store"]);
    const again = await fileHabitSeparately(db, userId, "ALCOHOL", ["beer store", "SAQ"]);
    expect(again).toEqual({ categoryId: first.categoryId, categoryName: "Alcohol", rulesAdded: 1 });
    expect(await db.category.count({ where: { userId, name: "Alcohol" } })).toBe(1);
  });
});

describe("habitMerchants", () => {
  const loaded = (habitsEnabled: boolean) =>
    ({
      habitsEnabled,
      visible: [{ key: "habit:GAMBLING", action: { kind: "track-habit", habit: "GAMBLING", merchants: ["Bet99"] } }],
      dismissed: [],
    }) as unknown as Parameters<typeof habitMerchants>[0];

  it("takes the merchants from the insight, and refuses when habits are off or not noticed", () => {
    expect(habitMerchants(loaded(true), "GAMBLING")).toEqual({ ok: true, merchants: ["Bet99"] });
    expect(habitMerchants(loaded(false), "GAMBLING")).toEqual({ ok: false, error: "Habit spending insights are turned off." });
    expect(habitMerchants(loaded(true), "CANNABIS").ok).toBe(false);
  });
});
