import type { PrismaClient } from "@prisma/client";
import { normalizeTagName, tagNameKey } from "@/lib/tags";
import { addTagsToTransaction } from "@/lib/tags-server";

/**
 * Tidying tags, shared by Settings → Rules' tag list (`src/app/actions/tags.ts`) and the phone
 * (`/api/v1/tags/:id`): rename (into another tag's name merges the two) and delete.
 */

export class TagEditError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "TagEditError";
  }
}

async function findOwnedTag(db: PrismaClient, userId: string, tagId: string) {
  const tag = tagId ? await db.tag.findFirst({ where: { id: tagId, userId } }) : null;
  if (!tag) throw new TagEditError("Tag not found.", true);
  return tag;
}

/**
 * Renames a tag. Renaming it to the name of another tag merges the two: its transactions and
 * rules (and saved searches) move to that tag, so "Trip" and "trips" can be tidied into one.
 * Returns the tag it was merged into, or null for a plain rename.
 */
export async function renameTag(db: PrismaClient, userId: string, tagId: string, rawName: string): Promise<{ id: string; name: string } | null> {
  const tag = await findOwnedTag(db, userId, tagId);
  const name = normalizeTagName(rawName);
  if (!name) throw new TagEditError("Enter a name for the tag.");
  const nameKey = tagNameKey(name);
  return db.$transaction(async (tx) => {
    const other = await tx.tag.findFirst({ where: { userId, nameKey, id: { not: tag.id } }, select: { id: true, name: true } });
    if (!other) {
      await tx.tag.update({ where: { id: tag.id }, data: { name, nameKey } });
      return null;
    }
    const links = await tx.transactionTag.findMany({ where: { tagId: tag.id }, select: { transactionId: true } });
    for (const { transactionId } of links) await addTagsToTransaction(tx, transactionId, [other.id]);
    await tx.transactionRule.updateMany({ where: { userId, addTagId: tag.id }, data: { addTagId: other.id } });
    await tx.savedSearch.updateMany({ where: { userId, tagId: tag.id }, data: { tagId: other.id } });
    await tx.tag.delete({ where: { id: tag.id } });
    return other;
  });
}

/** Deletes a tag. Transactions keep everything else; rules that added it stop adding a tag. */
export async function deleteTag(db: PrismaClient, userId: string, tagId: string): Promise<void> {
  const tag = await findOwnedTag(db, userId, tagId);
  await db.tag.delete({ where: { id: tag.id } });
}
