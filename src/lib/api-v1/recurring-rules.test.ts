import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Recurring rules from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-recurring-rules-"));
const url = `file:${join(dir, "recurring.db")}`;
let db: PrismaClient;
let api: typeof import("./recurring-rules");
let list: typeof import("./recurring");
let rules: typeof import("@/lib/recurring-rules");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./recurring-rules");
  list = await import("./recurring");
  rules = await import("@/lib/recurring-rules");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string };
let chequing: string;
let savings: string;
let streaming: string;
let salary: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({ data: { email: `rules${seq}@example.test`, displayName: "Test", timezone: "UTC" }, select: { id: true, timezone: true } });
  chequing = (await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } })).id;
  savings = (await db.account.create({ data: { userId: user.id, name: "Savings", type: "SAVINGS" } })).id;
  streaming = (await db.category.create({ data: { userId: user.id, name: "Streaming", kind: "EXPENSE" } })).id;
  salary = (await db.category.create({ data: { userId: user.id, name: "Salary", kind: "INCOME" } })).id;
});

const bill = () => ({
  type: "expense",
  accountId: chequing,
  categoryId: streaming,
  name: "Netflix",
  amountCents: 1_699,
  cadence: "monthly",
  nextExpectedDate: "2026-12-31",
  cancelUrl: "https://example.test/cancel",
  decideBy: "2026-12-20",
  note: "Family plan",
});

const now = new Date(Date.UTC(2026, 10, 6, 12));

describe("adding and changing a rule", () => {
  it("adds a bill with the cancel helper, and lists what its sheet needs", async () => {
    const created = await api.createRuleFromApi(db, user.id, bill());
    expect(created).toMatchObject({ ok: true });
    const { rules: on, paused } = await list.loadAppRecurring(user, now, db);
    expect(paused).toEqual([]);
    expect(on).toMatchObject([
      {
        name: "Netflix",
        type: "expense",
        cadence: "monthly",
        date: "2026-12-31",
        accountId: chequing,
        categoryId: streaming,
        transferAccountId: null,
        cancelUrl: "https://example.test/cancel",
        decideBy: "2026-12-20",
        note: "Family plan",
        autoPost: false,
        enabled: true,
      },
    ]);
  });

  it("changes a rule to twice a month on its own days, keeping the cancel fields when they are left out", async () => {
    const created = await api.createRuleFromApi(db, user.id, bill());
    if (!created.ok) throw new Error(created.error);
    const { cancelUrl: _url, decideBy: _by, ...rest } = bill();
    expect(
      await api.updateRuleFromApi(db, user.id, created.id, {
        ...rest,
        cadence: "semi_monthly",
        firstDay: 1,
        secondDay: 15,
        nextExpectedDate: "2026-12-02",
        autoPost: true,
      }),
    ).toEqual({ ok: true, id: created.id });
    const [rule] = (await list.loadAppRecurring(user, now, db)).rules;
    // It starts on the first of its days on or after the date entered.
    expect(rule).toMatchObject({ cadence: "semi_monthly", date: "2026-12-15", firstDay: 1, secondDay: 15, autoPost: true, cancelUrl: "https://example.test/cancel" });
  });

  it("adds a transfer to another open account, and refuses one to the same account", async () => {
    const transfer = { type: "transfer", accountId: chequing, transferAccountId: savings, name: "Save", amountCents: 50_000, cadence: "biweekly", nextExpectedDate: "2026-11-13" };
    expect(await api.createRuleFromApi(db, user.id, transfer)).toMatchObject({ ok: true });
    expect((await list.loadAppRecurring(user, now, db)).rules).toMatchObject([{ type: "transfer", toAccount: "Savings", category: null, cancelUrl: null }]);
    expect(await api.createRuleFromApi(db, user.id, { ...transfer, transferAccountId: chequing })).toEqual({
      ok: false,
      status: 400,
      error: "Choose two different accounts.",
    });
  });

  it("refuses a category of the other kind, a day that does not exist, and an end before the start", async () => {
    expect(await api.createRuleFromApi(db, user.id, { ...bill(), type: "income" })).toMatchObject({ ok: false, error: "Selected category was not found." });
    expect(await api.createRuleFromApi(db, user.id, { ...bill(), categoryId: salary, type: "income", nextExpectedDate: "2026-02-30" })).toMatchObject({
      ok: false,
      error: "That date does not exist.",
    });
    expect(await api.createRuleFromApi(db, user.id, { ...bill(), endDate: "2026-12-01" })).toMatchObject({
      ok: false,
      error: "End date must be on or after the next expected date.",
    });
    expect(await db.recurringTransaction.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("pausing, cancelling and deleting", () => {
  it("lists a paused or cancelled rule under paused, and turning it on undoes a cancel", async () => {
    const created = await api.createRuleFromApi(db, user.id, bill());
    if (!created.ok) throw new Error(created.error);

    await rules.cancelSubscription(db, user.id, created.id, now);
    let result = await list.loadAppRecurring(user, now, db);
    expect(result.rules).toEqual([]);
    expect(result.paused).toMatchObject([{ id: created.id, enabled: false, cancelledAt: "2026-11-06" }]);

    await rules.setRecurringRuleEnabled(db, user.id, created.id, true);
    result = await list.loadAppRecurring(user, now, db);
    expect(result.rules).toMatchObject([{ id: created.id, enabled: true, cancelledAt: null }]);

    await rules.deleteRecurringRule(db, user.id, created.id);
    expect(await db.recurringTransaction.count({ where: { userId: user.id } })).toBe(0);
  });

  it("only cancels a bill, and only the person's own rules change", async () => {
    const pay = await api.createRuleFromApi(db, user.id, { type: "income", accountId: chequing, categoryId: salary, name: "Pay", amountCents: 200_000, cadence: "biweekly", nextExpectedDate: "2026-11-13" });
    if (!pay.ok) throw new Error(pay.error);
    await expect(rules.cancelSubscription(db, user.id, pay.id)).rejects.toMatchObject({ notFound: true });
    await expect(rules.setRecurringRuleEnabled(db, "someone-else", pay.id, false)).rejects.toMatchObject({ notFound: true });
    await expect(rules.deleteRecurringRule(db, "someone-else", pay.id)).rejects.toMatchObject({ notFound: true });
    expect(await db.recurringTransaction.findUniqueOrThrow({ where: { id: pay.id }, select: { enabled: true } })).toEqual({ enabled: true });
  });
});
