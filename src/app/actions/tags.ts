"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { deleteTag, renameTag } from "@/lib/tag-edits";
import { formAction, getFormValue } from "./_helpers";

/** Renaming and deleting tags, saved through `src/lib/tag-edits.ts`, shared with the iPhone app. */

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
  await renameTag(prisma, user.id, getFormValue(formData, "tagId"), getFormValue(formData, "name"));
  revalidateTags();
});

/** Deletes a tag. Transactions keep everything else; rules that added it stop adding a tag. */
export const deleteTagAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deleteTag(prisma, user.id, getFormValue(formData, "tagId"));
  revalidateTags();
});
