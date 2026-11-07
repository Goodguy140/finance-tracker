"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSavedSearch, deleteSavedSearch } from "@/lib/search/saved-searches";
import { parseSearchTransactionType } from "@/lib/search/search-paths";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

/**
 * Saves the search on screen under a name. The filters come from the form as `/search` reads
 * them; the checks are `createSavedSearch`'s, shared with the phone.
 */
export const saveSearchAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const rawType = getFormValue(formData, "type");
  const type = parseSearchTransactionType(rawType) ?? null;
  if (rawType && !type) throw new Error("That search could not be saved. Reload and try again.");
  await createSavedSearch(prisma, user.id, {
    name: getFormValue(formData, "name"),
    query: getFormValue(formData, "q"),
    type,
    accountId: getFormValue(formData, "account") || null,
    categoryId: getFormValue(formData, "category") || null,
    tagId: getFormValue(formData, "tag") || null,
  });
  revalidatePath("/search");
});

export const deleteSavedSearchAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = z.string().min(1).parse(getFormValue(formData, "savedSearchId"));
  await deleteSavedSearch(prisma, user.id, id);
  revalidatePath("/search");
});
