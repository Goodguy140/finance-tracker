import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addTagsToTransaction, listTags, replaceTransactionTags, resolveTagIds } from "@/lib/tags-server";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Against a real database built from the migrations: the guarantees here are unique keys and cascades. */

const dir = mkdtempSync(join(tmpdir(), "tags-"));
const url = `file:${join(dir, "tags.db")}`;
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
let userId: string;
let transactionId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `t${seq}@example.test`, displayName: "Test" } })).id;
  const categoryId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  transactionId = (
    await db.transaction.create({
      data: { userId, categoryId, type: "EXPENSE", amountCents: 1200, date: new Date("2026-09-10T00:00:00Z") },
    })
  ).id;
});

async function tagNamesOn(id: string) {
  const links = await db.transactionTag.findMany({ where: { transactionId: id }, include: { tag: true } });
  return links.map((l) => l.tag.name).sort();
}

describe("resolveTagIds", () => {
  it("creates missing tags and reuses existing ones whatever their case", async () => {
    const [trip] = await resolveTagIds(db, userId, ["Trip"]);
    const [again, other] = await resolveTagIds(db, userId, ["trip", "Reimbursable"]);
    expect(again).toBe(trip);
    expect(other).not.toBe(trip);
    expect(await listTags(db, userId)).toEqual([
      { id: other, name: "Reimbursable" },
      { id: trip, name: "Trip" },
    ]);
  });

  it("keeps each user's tags apart", async () => {
    const [mine] = await resolveTagIds(db, userId, ["Trip"]);
    const otherUser = (await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } })).id;
    const [theirs] = await resolveTagIds(db, otherUser, ["Trip"]);
    expect(theirs).not.toBe(mine);
  });
});

describe("transaction tags", () => {
  it("adds without duplicating, and replaces to exactly the given set", async () => {
    const [trip, tax] = await resolveTagIds(db, userId, ["Trip", "Tax"]);
    await addTagsToTransaction(db, transactionId, [trip]);
    await addTagsToTransaction(db, transactionId, [trip, tax]);
    expect(await tagNamesOn(transactionId)).toEqual(["Tax", "Trip"]);

    await replaceTransactionTags(db, transactionId, [tax]);
    expect(await tagNamesOn(transactionId)).toEqual(["Tax"]);
    await replaceTransactionTags(db, transactionId, []);
    expect(await tagNamesOn(transactionId)).toEqual([]);
  });

  it("drops the links, not the transaction, when a tag is deleted, and clears rules that added it", async () => {
    const [trip] = await resolveTagIds(db, userId, ["Trip"]);
    await addTagsToTransaction(db, transactionId, [trip]);
    const rule = await db.transactionRule.create({
      data: { userId, priority: 0, titleOperator: "CONTAINS", titlePattern: "x", addTagId: trip },
    });
    await db.tag.delete({ where: { id: trip } });
    expect(await db.transaction.count({ where: { id: transactionId } })).toBe(1);
    expect(await tagNamesOn(transactionId)).toEqual([]);
    expect((await db.transactionRule.findUniqueOrThrow({ where: { id: rule.id } })).addTagId).toBeNull();
  });
});
