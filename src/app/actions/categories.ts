"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, SpendingRole } from "@prisma/client";
import { z } from "zod";
import {
  createCategory,
  deleteCategory,
  findManagedCategory,
  mergeCategory,
  renameCategory,
  setCategoryGroup,
  setCategorySpendingRole,
} from "@/lib/category-edits";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { setBudgetRollover, setMonthlyBudget, setYearlyBudget } from "@/lib/budget-edits";
import { positiveAmount } from "@/lib/validation";
import { isMappablePlaidCategory, plaidCategoryGroupOf } from "@/lib/plaid/category-taxonomy";
import { resuggestStagedCategories } from "@/lib/plaid/category-suggestions";
import { formAction, getFormValue } from "./_helpers";

/**
 * Category management: add, rename, merge, delete, the budget that goes with a category, and
 * which category each Plaid category lands in. Adding, renaming, merging, deleting, groups and
 * needs or wants save through `src/lib/category-edits.ts`, shared with the iPhone app.
 */

const manageableKind = z.enum([CategoryKind.EXPENSE, CategoryKind.INCOME]);
const idSchema = z.string().min(1);

async function afterCategoryChange(user: { id: string; timezone: string }) {
  // Staged rows pointed at a merged or deleted category, or a mapping changed: the queue
  // should propose what the settings now say.
  await resuggestStagedCategories(user.id, user.timezone);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
}

/** Adds a category, with an optional monthly budget from this month on. */
export const createCategoryAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const kind = manageableKind.parse(getFormValue(formData, "kind") || CategoryKind.EXPENSE);
  const rawLimit = getFormValue(formData, "limit").trim();
  const limitCents = rawLimit ? parseLimit(rawLimit) : null;
  await createCategory(prisma, user, { name: getFormValue(formData, "name"), kind, limitCents });
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Renames a category. Renaming it to the name of another category of the same kind merges
 * the two, so "Eating out" and "Dining" can be tidied into one without re-filing every
 * transaction by hand.
 */
export const renameCategoryAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await renameCategory(prisma, user.id, getFormValue(formData, "categoryId"), getFormValue(formData, "name"));
  await afterCategoryChange(user);
});

/** Merges one category into another of the same kind. */
export const mergeCategoryAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await mergeCategory(prisma, user.id, getFormValue(formData, "categoryId"), getFormValue(formData, "targetCategoryId"));
  await afterCategoryChange(user);
});

/**
 * Deletes a category. One that transactions, splits or recurring rules use needs somewhere
 * for them to go, so it is merged into `targetCategoryId` instead; an unused one simply goes,
 * along with its budgets. Rules that set it stop setting a category (the relation's SetNull).
 */
export const deleteCategoryAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const targetId = getFormValue(formData, "targetCategoryId").trim();
  await deleteCategory(prisma, user.id, getFormValue(formData, "categoryId"), targetId || null);
  await afterCategoryChange(user);
});

function parseLimit(raw: string, period: "monthly" | "yearly" = "monthly"): number {
  const parsed = positiveAmount.safeParse(raw.replace(/[$,\s]/g, ""));
  if (!parsed.success) throw new Error(`Enter a ${period} limit above zero.`);
  return toCents(parsed.data);
}

/**
 * Sets a category's monthly budget from this month on, or removes it (`intent=remove`).
 *
 * Setting writes this month's row, which rolls forward exactly as one saved from the
 * Budgets tab does; earlier months keep the limits they had. Removing deletes every budget
 * row the category has, past months included — "no budget" has no row of its own to mean
 * it, so leaving an older rolling row would quietly bring the old limit back. Per-month
 * history is still editable row by row in the Budgets tab.
 */
export const setCategoryBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const categoryId = idSchema.parse(getFormValue(formData, "categoryId"));
  const limitCents = getFormValue(formData, "intent") === "remove" ? null : parseLimit(getFormValue(formData, "limit").trim());
  await setMonthlyBudget(prisma, user, categoryId, limitCents);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Turns budget rollover on or off for an expense category (`enabled=true|false`).
 *
 * On, it counts from the current month: this month's leftover (or overspend) is the first to
 * carry into the next. Turning it on again while on keeps the original month, so a double
 * submit does not throw away what has built up. Off forgets it; turned on again later, it
 * starts afresh from that month.
 */
export const setCategoryRolloverAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const categoryId = idSchema.parse(getFormValue(formData, "categoryId"));
  await setBudgetRollover(prisma, user, categoryId, getFormValue(formData, "enabled") === "true");
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Says which category a Plaid category lands in, or (empty `categoryId`) returns it to the
 * built-in default. Rows still waiting in the review queue are re-suggested at once.
 */
/**
 * Sets a category's yearly budget from this year on, or removes it (`intent=remove`, every
 * year). Earlier years keep the limits they had.
 */
export const setCategoryYearlyBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const categoryId = idSchema.parse(getFormValue(formData, "categoryId"));
  const limitCents = getFormValue(formData, "intent") === "remove" ? null : parseLimit(getFormValue(formData, "limit").trim(), "yearly");
  await setYearlyBudget(prisma, user, categoryId, limitCents);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Marks an expense category as a need or a want for the financial score's 50/30/20 split, or
 * goes back to the guess from its name ("auto").
 */
export const setCategorySpendingRoleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const raw = getFormValue(formData, "spendingRole");
  const spendingRole = raw === "NEED" ? SpendingRole.NEED : raw === "WANT" ? SpendingRole.WANT : null;
  await setCategorySpendingRole(prisma, user.id, getFormValue(formData, "categoryId"), spendingRole);
  revalidatePath("/insights");
  revalidatePath("/settings", "layout");
});

/**
 * Files a category under a group, or takes it out of one (an empty name). A group is matched to
 * an existing one ignoring case, so "food" joins "Food" rather than starting a second group.
 */
export const setCategoryGroupAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await setCategoryGroup(prisma, user.id, getFormValue(formData, "categoryId"), getFormValue(formData, "groupName"));
  revalidatePath("/");
  revalidatePath("/reports", "layout");
  revalidatePath("/settings", "layout");
});

export const setPlaidCategoryMappingAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const plaidCategory = getFormValue(formData, "plaidCategory").trim().toUpperCase();
  if (!isMappablePlaidCategory(plaidCategory)) throw new Error("Unknown Plaid category.");
  const categoryId = getFormValue(formData, "categoryId").trim();

  if (!categoryId) {
    await prisma.plaidCategoryMapping.deleteMany({ where: { userId: user.id, plaidCategory } });
  } else {
    const category = await findManagedCategory(prisma, user.id, categoryId);
    const group = plaidCategoryGroupOf(plaidCategory);
    if (group && group.kind !== category.kind) {
      throw new Error(
        group.kind === CategoryKind.INCOME
          ? "Plaid income can only map to an income category."
          : "Plaid spending can only map to an expense category.",
      );
    }
    await prisma.plaidCategoryMapping.upsert({
      where: { userId_plaidCategory: { userId: user.id, plaidCategory } },
      update: { categoryId: category.id },
      create: { userId: user.id, plaidCategory, categoryId: category.id },
    });
  }
  await afterCategoryChange(user);
});
