import type { Prisma, PrismaClient } from "@prisma/client";
import { tagNameKey, type TagOption } from "@/lib/tags";

type Db = PrismaClient | Prisma.TransactionClient;

export async function listTags(db: Db, userId: string): Promise<TagOption[]> {
  return db.tag.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { nameKey: "asc" } });
}

/**
 * Ids for these names, creating the ones the user does not have yet: tags are made by typing
 * them on a transaction or a rule, there is no separate step. Matched case-insensitively, so
 * an existing tag keeps its original spelling. Returned in the order given.
 */
export async function resolveTagIds(db: Db, userId: string, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const keys = names.map(tagNameKey);
  const existing = await db.tag.findMany({ where: { userId, nameKey: { in: keys } }, select: { id: true, nameKey: true } });
  const idByKey = new Map(existing.map((tag) => [tag.nameKey, tag.id]));
  for (const [index, key] of keys.entries()) {
    if (idByKey.has(key)) continue;
    // Upsert, not create: a second form submitted at the same moment may have just made it.
    const created = await db.tag.upsert({
      where: { userId_nameKey: { userId, nameKey: key } },
      create: { userId, name: names[index], nameKey: key },
      update: {},
      select: { id: true },
    });
    idByKey.set(key, created.id);
  }
  return keys.map((key) => idByKey.get(key)!);
}

/** Adds tags to a transaction, leaving any it already has. */
export async function addTagsToTransaction(db: Db, transactionId: string, tagIds: readonly string[]) {
  if (tagIds.length === 0) return;
  const present = await db.transactionTag.findMany({
    where: { transactionId, tagId: { in: [...tagIds] } },
    select: { tagId: true },
  });
  const have = new Set(present.map((row) => row.tagId));
  const missing = [...new Set(tagIds)].filter((id) => !have.has(id));
  if (missing.length > 0) {
    await db.transactionTag.createMany({ data: missing.map((tagId) => ({ transactionId, tagId })) });
  }
}

/** Makes the transaction's tags exactly these: what the edit form saves. */
export async function replaceTransactionTags(db: Db, transactionId: string, tagIds: readonly string[]) {
  await db.transactionTag.deleteMany({ where: { transactionId, tagId: { notIn: [...tagIds] } } });
  await addTagsToTransaction(db, transactionId, tagIds);
}
