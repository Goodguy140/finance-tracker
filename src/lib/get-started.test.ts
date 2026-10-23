import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { getStartedSteps, loadGetStarted } from "./get-started";

const none = { plaidConfigured: true, bankCount: 0, transactionCount: 0, budgetCount: 0, recurringCount: 0, balanceCount: 0 };

describe("get started steps", () => {
  it("lists every step undone for a new user", () => {
    const steps = getStartedSteps(none);
    expect(steps.map((s) => s.id)).toEqual(["bank", "transactions", "budget", "recurring", "balances"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("leaves out connecting a bank when the server has no Plaid keys", () => {
    expect(getStartedSteps({ ...none, plaidConfigured: false }).map((s) => s.id)).not.toContain("bank");
  });

  it("ticks each step off from what the user has", () => {
    const steps = getStartedSteps({ ...none, transactionCount: 3, budgetCount: 1 });
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(["transactions", "budget"]);
  });
});

const dir = mkdtempSync(join(tmpdir(), "get-started-"));
const url = `file:${join(dir, "gs.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; getStartedDismissedAt: Date | null };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({ data: { email: `g${seq}@example.test`, displayName: "Test" } });
});

describe("loading the checklist", () => {
  it("reads progress from the user's own rows only", async () => {
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const cat = await db.category.create({ data: { userId: other.id, name: "Food", kind: "EXPENSE" } });
    await db.budget.create({ data: { userId: other.id, categoryId: cat.id, periodMonth: "2026-10", limitCents: 100 } });

    const steps = await loadGetStarted(db, user, false);
    expect(steps?.find((s) => s.id === "budget")?.done).toBe(false);

    const mine = await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } });
    await db.budget.create({ data: { userId: user.id, categoryId: mine.id, periodMonth: "2026-10", limitCents: 100 } });
    expect((await loadGetStarted(db, user, false))?.find((s) => s.id === "budget")?.done).toBe(true);
  });

  it("is gone once hidden", async () => {
    expect(await loadGetStarted(db, user, false)).not.toBeNull();
    const hidden = await db.user.update({ where: { id: user.id }, data: { getStartedDismissedAt: new Date() } });
    expect(await loadGetStarted(db, hidden, false)).toBeNull();
  });

  it("is gone once every step is done", async () => {
    const cat = await db.category.create({ data: { userId: user.id, name: "Rent", kind: "EXPENSE" } });
    const account = await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } });
    await db.transaction.create({
      data: { userId: user.id, categoryId: cat.id, type: "EXPENSE", amountCents: 1, date: new Date("2026-10-01T00:00:00Z") },
    });
    await db.budget.create({ data: { userId: user.id, categoryId: cat.id, periodMonth: "2026-10", limitCents: 100 } });
    await db.recurringTransaction.create({
      data: {
        userId: user.id,
        categoryId: cat.id,
        type: "EXPENSE",
        accountId: account.id,
        name: "Rent",
        amountCents: 100,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-11-01T00:00:00Z"),
      },
    });
    expect(await loadGetStarted(db, user, false)).not.toBeNull();
    await db.accountBalanceSnapshot.create({
      data: { userId: user.id, accountId: account.id, date: new Date("2026-10-01T00:00:00Z"), balanceCents: 5, source: "MANUAL" },
    });
    expect(await loadGetStarted(db, user, false)).toBeNull();
  });
});
