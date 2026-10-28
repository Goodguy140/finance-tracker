"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { normalizeTagName, tagNameKey } from "@/lib/tags";
import { addTagsToTransaction } from "@/lib/tags-server";
import { formAction, getFormValue } from "./_helpers";

const tagIdSchema = z.string().min(1);

async function findOwnedTag(userId: string, tagId: string) {
  const tag = await prisma.tag.findFirst({ where: { id: tagIdSchema.parse(tagId), userId } });
  if (!tag) throw new Error("Tag not found.");
  return tag;
}

function revalidateTags() {
  revalidatePath("/");
  revalidatePath("/settings", "layout");
}

/**
 * Renames a tag. Renaming it to the name of another tag merges the two: its transactions and
 * rules (and saved searches) move to that tag, so "Trip" and "trips" can be tidied into one.
 */
export const renameTagAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const tag = await findOwnedTag(user.id, getFormValue(formData, "tagId"));
  const name = normalizeTagName(getFormValue(formData, "name"));
  if (!name) throw new Error("Enter a name for the tag.");
  const nameKey = tagNameKey(name);

  await prisma.$transaction(async (tx) => {
    const other = await tx.tag.findFirst({ where: { userId: user.id, nameKey, id: { not: tag.id } } });
    if (!other) {
      await tx.tag.update({ where: { id: tag.id }, data: { name, nameKey } });
      return;
    }
    const links = await tx.transactionTag.findMany({ where: { tagId: tag.id }, select: { transactionId: true } });
    for (const { transactionId } of links) await addTagsToTransaction(tx, transactionId, [other.id]);
    await tx.transactionRule.updateMany({ where: { userId: user.id, addTagId: tag.id }, data: { addTagId: other.id } });
    await tx.savedSearch.updateMany({ where: { userId: user.id, tagId: tag.id }, data: { tagId: other.id } });
    await tx.tag.delete({ where: { id: tag.id } });
  });
  revalidateTags();
});

/** Deletes a tag. Transactions keep everything else; rules that added it stop adding a tag. */
export const deleteTagAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const tag = await findOwnedTag(user.id, getFormValue(formData, "tagId"));
  await prisma.tag.delete({ where: { id: tag.id } });
  revalidateTags();
});
