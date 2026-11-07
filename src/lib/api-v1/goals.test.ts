import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Savings goals from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-goals-"));
const url = `file:${join(dir, "goals.db")}`;
let db: PrismaClient;
let api: typeof import("./goals");
let data: typeof import("@/lib/savings-goals-data");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./goals");
  data = await import("@/lib/savings-goals-data");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };
let savings: string;
let card: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `goals${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  savings = (await db.account.create({ data: { userId: user.id, name: "Savings", type: "SAVINGS" } })).id;
  card = (await db.account.create({ data: { userId: user.id, name: "Visa", type: "CREDIT_CARD" } })).id;
});

const read = async () => api.serializeGoals(await data.loadSavingsGoals(user));

describe("savings goals on the phone", () => {
  it("adds a hand-tracked goal and one that follows an account, soonest date first", async () => {
    await db.accountBalanceSnapshot.create({
      data: { userId: user.id, accountId: savings, date: new Date(), balanceCents: 250_000, source: "MANUAL" },
    });
    const trip = await api.createGoalFromApi(db, user.id, { name: "Trip", targetCents: 200_000, targetDate: "2099-06-01", savedCents: 50_000 });
    const fund = await api.createGoalFromApi(db, user.id, { name: "Rainy day", targetCents: 1_000_000, accountId: savings, savedCents: 99 });
    expect(trip.ok && fund.ok).toBe(true);

    const { goals, accounts } = await read();
    expect(accounts.map((a) => a.name)).toEqual(["Savings"]);
    expect(goals.map((g) => [g.name, g.savedCents, g.percent, g.targetDate])).toEqual([
      ["Trip", 50_000, 25, "2099-06-01"],
      // It follows the balance; the 99 sent with it is not kept as a hand-recorded amount.
      ["Rainy day", 250_000, 25, null],
    ]);
    expect(goals[0]).toMatchObject({ status: "needs", account: null, currency: "CAD" });
    expect(goals[0].monthlyNeededCents).toBeGreaterThan(0);
    expect(goals[1]).toMatchObject({ status: "open", account: { id: savings, name: "Savings" }, manualSavedCents: 0 });
  });

  it("refuses a card, another person's account and a goal with no target", async () => {
    expect(await api.createGoalFromApi(db, user.id, { name: "Pay off", targetCents: 100, accountId: card })).toEqual({
      ok: false,
      status: 400,
      error: "Pick an account that holds the savings, not a card or loan.",
    });
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.account.create({ data: { userId: other.id, name: "Theirs", type: "SAVINGS" } });
    expect(await api.createGoalFromApi(db, user.id, { name: "Mine", targetCents: 100, accountId: theirs.id })).toMatchObject({
      ok: false,
      error: "Selected account was not found.",
    });
    expect(await api.createGoalFromApi(db, user.id, { name: "Nothing", targetCents: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await db.savingsGoal.count({ where: { userId: user.id } })).toBe(0);
  });

  it("puts money in and takes it out of a hand-tracked goal, keeps it through an edit, and deletes it", async () => {
    const made = await api.createGoalFromApi(db, user.id, { name: "Bike", targetCents: 80_000, savedCents: 10_000 });
    if (!made.ok) throw new Error(made.error);
    expect(await api.contributeFromApi(db, user.id, made.id, { amountCents: 5_000 })).toEqual({ ok: true, id: made.id });
    expect(await api.contributeFromApi(db, user.id, made.id, { amountCents: -100_000 })).toEqual({ ok: true, id: made.id });
    expect((await read()).goals[0].savedCents).toBe(0);
    await api.contributeFromApi(db, user.id, made.id, { amountCents: 2_000 });

    // Renamed without a saved amount: what was put in stays.
    expect(await api.updateGoalFromApi(db, user.id, made.id, { name: "New bike", targetCents: 90_000, targetDate: null })).toEqual({ ok: true, id: made.id });
    expect((await read()).goals[0]).toMatchObject({ name: "New bike", targetCents: 90_000, savedCents: 2_000 });

    const linked = await api.createGoalFromApi(db, user.id, { name: "Linked", targetCents: 100, accountId: savings });
    if (!linked.ok) throw new Error(linked.error);
    expect(await api.contributeFromApi(db, user.id, linked.id, { amountCents: 100 })).toMatchObject({ ok: false, status: 400 });

    expect(await api.deleteGoalFromApi(db, user.id, made.id)).toEqual({ ok: true, id: made.id });
    expect(await api.deleteGoalFromApi(db, user.id, made.id)).toEqual({ ok: false, status: 404, error: "Goal not found." });
  });
});
