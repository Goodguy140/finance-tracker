import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Reconciling an account with a statement from the phone, against a real SQLite database. */

const dir = mkdtempSync(join(tmpdir(), "api-reconcile-"));
const url = `file:${join(dir, "reconcile.db")}`;
let db: PrismaClient;
let api: typeof import("./reconcile");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./reconcile");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const q = (params: Record<string, string>) => new URLSearchParams(params);

it("checks a statement against the log, marks a match reconciled, picks up after it, and forgets it", async () => {
  const user = await db.user.create({ data: { email: "reconcile@example.test", displayName: "Test", timezone: "UTC" }, select: { id: true, timezone: true } });
  const userId = user.id;
  const food = await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } });
  const pay = await db.category.create({ data: { userId, name: "Pay", kind: "INCOME" } });
  const chequing = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
  const visa = await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } });
  const add = (type: "EXPENSE" | "INCOME", amountCents: number, ymd: string, accountId: string) =>
    db.transaction.create({
      data: { userId, type, amountCents, accountId, categoryId: type === "EXPENSE" ? food.id : pay.id, title: type === "EXPENSE" ? "Shop" : "Pay", date: new Date(`${ymd}T00:00:00Z`) },
    });
  await add("INCOME", 100_000, "2026-09-05", chequing.id);
  await add("EXPENSE", 20_000, "2026-09-10", chequing.id);
  await add("EXPENSE", 7_000, "2026-10-02", chequing.id);
  await add("EXPENSE", 5_000, "2026-09-12", visa.id);

  const statement = { from: "2026-09-01", to: "2026-09-30" };
  const off = await api.loadAppReconcile(db, user, chequing.id, q({ ...statement, openingCents: "50000", closingCents: "129000" }));
  expect(off).toMatchObject({ ok: true, from: "2026-09-01", to: "2026-09-30" });
  if (!off.ok) throw new Error(off.error);
  expect(off.check).toMatchObject({ moneyInCents: 100_000, moneyOutCents: 20_000, expectedClosingCents: 130_000, differenceCents: -1_000, statementShows: "less" });
  expect(off.check?.rows.map((r) => [r.date, r.inCents, r.balanceCents])).toEqual([
    ["2026-09-05", 100_000, 150_000],
    ["2026-09-10", -20_000, 130_000],
  ]);
  expect(await api.saveReconciliationFromApi(db, userId, chequing.id, { ...statement, openingCents: 50_000, closingCents: 129_000 })).toEqual({
    ok: false,
    status: 400,
    error: "The log does not match this statement yet.",
  });

  // A card's balances are what is owed: owing more than the log says is less money in the account.
  const card = await api.loadAppReconcile(db, user, visa.id, q({ ...statement, openingCents: "0", closingCents: "6000" }));
  expect(card.ok && card.check).toMatchObject({ expectedClosingCents: 5_000, differenceCents: 1_000, statementShows: "less" });

  const saved = await api.saveReconciliationFromApi(db, userId, chequing.id, { ...statement, openingCents: 50_000, closingCents: 130_000 });
  if (!saved.ok) throw new Error(saved.error);
  expect(await db.accountBalanceSnapshot.findMany({ where: { accountId: chequing.id }, select: { balanceCents: true, source: true } })).toEqual([
    { balanceCents: 130_000, source: "MANUAL" },
  ]);

  // The next statement starts the day after, from that closing balance.
  const next = await api.loadAppReconcile(db, user, chequing.id, q({}));
  expect(next).toMatchObject({ ok: true, from: "2026-10-01", to: "2026-10-31", openingCents: 130_000, closingCents: null, check: null });
  expect(next.ok && next.history).toEqual([{ id: saved.id, from: "2026-09-01", to: "2026-09-30", openingCents: 50_000, closingCents: 130_000 }]);

  expect(await api.loadAppReconcile(db, user, chequing.id, q({ from: "2026-10-05", to: "2026-10-01" }))).toMatchObject({ ok: false, status: 400 });
  expect(await api.deleteReconciliationFromApi(db, userId, visa.id, saved.id)).toMatchObject({ ok: false, status: 404 });
  expect(await api.deleteReconciliationFromApi(db, userId, chequing.id, saved.id)).toEqual({ ok: true });
  expect(await db.accountReconciliation.count({ where: { userId } })).toBe(0);
});
