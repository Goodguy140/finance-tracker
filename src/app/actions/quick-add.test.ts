import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "quick-add-"));
const url = `file:${join(dir, "quick-add.db")}`;
let db: PrismaClient;
let actions: typeof import("./quick-add");
let preview: typeof import("@/lib/search/quick-add-server");

const session = vi.hoisted(() => ({ user: null as null | { id: string; timezone: string } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => session.user) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./quick-add");
  preview = await import("@/lib/search/quick-add-server");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let chequingId: string;
let tfsaId: string;

beforeEach(async () => {
  seq += 1;
  const user = await db.user.create({ data: { email: `quick${seq}@example.test`, displayName: "Quick", timezone: "America/Toronto" } });
  session.user = { id: user.id, timezone: "America/Toronto" };
  await db.category.create({ data: { userId: user.id, name: "Other", kind: "EXPENSE" } });
  chequingId = (await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } })).id;
  tfsaId = (await db.account.create({ data: { userId: user.id, name: "TFSA", type: "TFSA" } })).id;
  await db.user.update({ where: { id: user.id }, data: { defaultExpenseAccountId: chequingId } });
  await db.transactionRule.create({
    data: { userId: user.id, priority: 1, titleOperator: "CONTAINS", titlePattern: "tfsa", markAsTransfer: true, setTransferAccountId: tfsaId },
  });
});

describe("quick add from the master search", () => {
  it("offers, books and undoes a transfer when a 'Mark as transfer' rule matches", async () => {
    const userId = session.user!.id;
    expect(await preview.previewQuickAdd(db, session.user!, "500 tfsa top-up")).toMatchObject({
      amountCents: 50_000,
      accountName: "Chequing",
      transfer: { toAccountName: "TFSA" },
    });
    expect(await preview.previewQuickAdd(db, session.user!, "12.50 coffee")).toMatchObject({ categoryName: "Other", transfer: null });

    const added = await actions.quickAddExpenseAction("500 tfsa top-up");
    expect(added).toMatchObject({ ok: true, message: expect.stringContaining("as a transfer") });
    if (!added.ok) return;
    expect(await db.transaction.findUniqueOrThrow({ where: { id: added.transactionId } })).toMatchObject({
      type: "TRANSFER",
      amountCents: 50_000,
      accountId: chequingId,
      transferAccountId: tfsaId,
    });

    expect(await actions.undoQuickAddAction(added.transactionId)).toEqual({ ok: true });
    expect(await db.transaction.count({ where: { userId } })).toBe(0);
  });
});
