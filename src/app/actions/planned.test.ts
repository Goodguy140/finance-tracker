import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** A plan is done once the log has its entry, whichever way the entry got there. */

const dir = mkdtempSync(join(tmpdir(), "planned-"));
const url = `file:${join(dir, "planned.db")}`;
let db: PrismaClient;
let actions: typeof import("./planned");
let data: typeof import("@/lib/planned-transactions-data");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/webhooks", () => ({ emitWebhookEvent: vi.fn() }));

let accountId = "";
let categoryId = "";

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./planned");
  data = await import("@/lib/planned-transactions-data");
  session.userId = (await db.user.create({ data: { email: "plans@example.test", displayName: "Test" } })).id;
  accountId = (await db.account.create({ data: { userId: session.userId, name: "Visa", type: "CREDIT_CARD" } })).id;
  categoryId = (await db.category.create({ data: { userId: session.userId, name: "Car", kind: "EXPENSE" } })).id;
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function addPlan(name: string, amount: string, date: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ type: "EXPENSE", name, amount, date, accountId, categoryId })) form.set(k, v);
  expect(await actions.createPlannedTransactionAction(form)).toBeUndefined();
  return db.plannedTransaction.findFirstOrThrow({ where: { userId: session.userId, name } });
}

describe("planned transactions", () => {
  it("settles a plan when its entry reaches the log, and reopens it when the entry is deleted", async () => {
    const plan = await addPlan("Brakes", "800", "2026-11-10");
    expect((await data.loadOpenPlannedTransactions(session.userId)).map((p) => p.id)).toContain(plan.id);

    const entry = await db.transaction.create({
      data: {
        userId: session.userId,
        accountId,
        categoryId,
        type: "EXPENSE",
        amountCents: 76_000,
        date: new Date("2026-11-12T00:00:00Z"),
      },
    });
    expect((await data.loadOpenPlannedTransactions(session.userId)).map((p) => p.id)).not.toContain(plan.id);
    expect((await db.plannedTransaction.findUniqueOrThrow({ where: { id: plan.id } })).transactionId).toBe(entry.id);

    await db.transaction.delete({ where: { id: entry.id } });
    expect((await data.loadOpenPlannedTransactions(session.userId)).map((p) => p.id)).toContain(plan.id);
  });

  it("adds a plan that happened to the log once, however often it is submitted", async () => {
    const plan = await addPlan("Tires", "600", "2026-10-01");
    const form = new FormData();
    form.set("planId", plan.id);
    expect(await actions.recordPlannedTransactionAction(form)).toBeUndefined();
    expect(await actions.recordPlannedTransactionAction(form)).toMatchObject({ ok: false });

    const entries = await db.transaction.findMany({ where: { userId: session.userId, title: "Tires" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountCents: 60_000, accountId, categoryId });
    expect((await db.plannedTransaction.findUniqueOrThrow({ where: { id: plan.id } })).transactionId).toBe(entries[0].id);
  });
});
