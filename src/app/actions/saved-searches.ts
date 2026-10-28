"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MAX_SAVED_SEARCH_NAME_LENGTH, MAX_SAVED_SEARCHES, parseSearchTransactionType } from "@/lib/search/search-paths";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the search a name.")
  .max(MAX_SAVED_SEARCH_NAME_LENGTH, `Keep the name under ${MAX_SAVED_SEARCH_NAME_LENGTH} characters.`);

/**
 * Saves the search on screen under a name. The filters come from the form as `/search` reads
 * them; an account, category or tag that is not the user's is refused rather than dropped, which
 * would save a wider search than the one shown.
 */
export const saveSearchAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const name = nameSchema.parse(getFormValue(formData, "name"));
  const query = getFormValue(formData, "q").trim().slice(0, 100) || null;
  const rawType = getFormValue(formData, "type");
  const type = parseSearchTransactionType(rawType) ?? null;
  if (rawType && !type) throw new Error("That search could not be saved. Reload and try again.");
  const accountId = getFormValue(formData, "account") || null;
  const categoryId = getFormValue(formData, "category") || null;
  const tagId = getFormValue(formData, "tag") || null;
  if (!query && !type && !accountId && !categoryId && !tagId) throw new Error("Search for something first, then save it.");

  const [account, category, tag, count] = await Promise.all([
    accountId ? prisma.account.count({ where: { id: accountId, userId: user.id } }) : 1,
    categoryId ? prisma.category.count({ where: { id: categoryId, userId: user.id } }) : 1,
    tagId ? prisma.tag.count({ where: { id: tagId, userId: user.id } }) : 1,
    prisma.savedSearch.count({ where: { userId: user.id } }),
  ]);
  if (!account || !category || !tag) throw new Error("That search could not be saved. Reload and try again.");
  if (count >= MAX_SAVED_SEARCHES) {
    throw new Error(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Remove one you no longer use first.`);
  }
  await prisma.savedSearch.create({ data: { userId: user.id, name, query, type, accountId, categoryId, tagId } });
  revalidatePath("/search");
});

export const deleteSavedSearchAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = z.string().min(1).parse(getFormValue(formData, "savedSearchId"));
  const { count } = await prisma.savedSearch.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw new Error("That saved search was already removed.");
  revalidatePath("/search");
});
