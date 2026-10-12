import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a hand-entered balance, against a real SQLite database built from the migrations.
 * Only the user's own manual entries can go; a bank's balance would just come back on sync.
 */

const dir = mkdtempSync(join(tmpdir(), "account-balances-"));
const url = `file:${join(dir, "balances.db")}`;
let db: PrismaClient;
let actions: typeof import("./accounts");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./accounts");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `b${seq}@example.test`, displayName: "Test" } })).id;
  accountId = (await db.account.create({ data: { userId: session.userId, name: "Mortgage", type: "LOAN" } })).id;
});

function snapshot(source: "MANUAL" | "PLAID", day: number, userId = session.userId, account = accountId) {
  return db.accountBalanceSnapshot.create({
    data: { userId, accountId: account, date: new Date(Date.UTC(2026, 8, day)), balanceCents: 100_00 * day, source },
  });
}

function form(id: string) {
  const data = new FormData();
  data.set("id", id);
  return data;
}

describe("deleteAccountBalanceAction", () => {
  it("removes a manual entry and leaves the account's other balances", async () => {
    const keep = await snapshot("MANUAL", 1);
    const gone = await snapshot("MANUAL", 2);

    expect(await actions.deleteAccountBalanceAction(form(gone.id))).toBeUndefined();

    const left = await db.accountBalanceSnapshot.findMany({ where: { accountId } });
    expect(left.map((row) => row.id)).toEqual([keep.id]);
  });

  it("refuses a balance synced from the bank", async () => {
    const synced = await snapshot("PLAID", 3);

    expect(await actions.deleteAccountBalanceAction(form(synced.id))).toEqual({
      ok: false,
      error: "That balance entry was not found.",
    });
    expect(await db.accountBalanceSnapshot.count({ where: { id: synced.id } })).toBe(1);
  });

  it("refuses another user's entry", async () => {
    const otherUser = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const otherAccount = await db.account.create({ data: { userId: otherUser.id, name: "Cash", type: "CASH" } });
    const theirs = await snapshot("MANUAL", 4, otherUser.id, otherAccount.id);

    expect(await actions.deleteAccountBalanceAction(form(theirs.id))).toMatchObject({ ok: false });
    expect(await db.accountBalanceSnapshot.count({ where: { id: theirs.id } })).toBe(1);
  });
});
