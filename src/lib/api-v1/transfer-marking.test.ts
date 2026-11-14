import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { changeTransferFromApi, parseTransferChangeBody } from "./transfer-marking";

const dir = mkdtempSync(join(tmpdir(), "api-transfer-marking-"));
const url = `file:${join(dir, "api.db")}`;
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
let foodId: string;
let chequingId: string;
let visaId: string;
let seq = 0;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `m${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  chequingId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
  visaId = (await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } })).id;
});

function expense(amountCents: number, accountId = chequingId) {
  return db.transaction.create({
    data: { userId, categoryId: foodId, type: "EXPENSE", amountCents, accountId, date: new Date("2026-11-03T00:00:00Z"), title: "Visa payment" },
  });
}

describe("changeTransferFromApi", () => {
  it("marks an expense as a transfer and answers it as the phone shows it", async () => {
    const paid = await expense(40_000);
    const result = await changeTransferFromApi(db, userId, paid.id, "mark");
    expect(result.ok && result.transaction).toMatchObject({ id: paid.id, type: "transfer", amountCents: 40_000, categoryName: "Transfers", title: "Visa payment" });
    expect(result.ok && result.countsAgain).toBe(false);
  });

  it("counts both legs of a pair again, and only unmarking says so", async () => {
    const out = await expense(25_000);
    await changeTransferFromApi(db, userId, out.id, "mark");
    const into = await db.transaction.create({
      data: { userId, categoryId: (await db.transaction.findUniqueOrThrow({ where: { id: out.id } })).categoryId, type: "TRANSFER", amountCents: -25_000, accountId: visaId, date: new Date("2026-11-04T00:00:00Z") },
    });
    await db.transaction.update({ where: { id: out.id }, data: { transferPeerId: into.id, transferAccountId: visaId } });
    await db.transaction.update({ where: { id: into.id }, data: { transferPeerId: out.id, transferAccountId: chequingId } });

    const unpaired = await changeTransferFromApi(db, userId, into.id, "unpair");
    expect(unpaired.ok && unpaired.transaction).toMatchObject({ type: "transfer", transferPeerId: null, transferAccountId: null });
    // Unpaired, the second change finds no pair.
    expect(await changeTransferFromApi(db, userId, into.id, "unpair")).toEqual({ ok: false, status: 404, error: "No paired transfer with that id." });

    await db.transaction.update({ where: { id: out.id }, data: { transferPeerId: into.id } });
    await db.transaction.update({ where: { id: into.id }, data: { transferPeerId: out.id } });
    const unmarked = await changeTransferFromApi(db, userId, out.id, "unmark");
    expect(unmarked.ok && unmarked.countsAgain).toBe(true);
    expect(unmarked.ok && unmarked.transaction.type).toBe("expense");
    expect((await db.transaction.findUniqueOrThrow({ where: { id: into.id } })).type).toBe("INCOME");
  });

  it("refuses a split with the website's reason, and someone else's entry as not found", async () => {
    const shared = await expense(9_000);
    await db.splitTransactionPart.create({ data: { userId, transactionId: shared.id, categoryId: foodId, amountCents: 9_000 } });
    expect(await changeTransferFromApi(db, userId, shared.id, "mark")).toEqual({
      ok: false,
      status: 409,
      error: "A split expense cannot be a transfer. Remove the split first.",
    });
    const mine = await expense(1_000);
    const other = (await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } })).id;
    expect((await changeTransferFromApi(db, other, mine.id, "mark")).ok).toBe(false);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: mine.id } })).type).toBe("EXPENSE");
  });
});

describe("parseTransferChangeBody", () => {
  it("takes one of the three changes and nothing else", () => {
    expect(parseTransferChangeBody({ change: "unpair" })).toEqual({ ok: true, change: "unpair" });
    expect(parseTransferChangeBody({ change: "delete" }).ok).toBe(false);
    expect(parseTransferChangeBody({ change: "mark", extra: 1 }).ok).toBe(false);
  });
});
