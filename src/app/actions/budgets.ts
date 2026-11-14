"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind } from "@prisma/client";
import { toCents } from "@/lib/money";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { applyBudgetSuggestions, reallocateBudgets } from "@/lib/budget-edits";
import { requireUser } from "@/lib/session";
import {
  applyBudgetSuggestionsSchema,
  budgetSchema,
  deleteBudgetSchema,
  reallocateBudgetSchema,
  updateBudgetSchema,
} from "@/lib/validation";
import {
  getFormValue,
  formAction,
  parseJsonField,
} from "./_helpers";
export const upsertBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const rawPeriodMonth = getFormValue(formData, "periodMonth");
  const parsed = budgetSchema.safeParse({
    categoryName: getFormValue(formData, "categoryName"),
    limit: getFormValue(formData, "limit"),
    periodMonth: rawPeriodMonth || undefined,
  });
  if (!parsed.success) {
    throw new Error("Category name and budget limit are required.");
  }
  const payload = parsed.data;
  // "This month" is the user's, not the container's: the same instant is a different
  // calendar month across the date line.
  const currentPeriodMonth = currentYmInTimeZone(user.timezone);
  const periodMonth = payload.periodMonth ?? currentPeriodMonth;

  if (payload.periodMonth && payload.periodMonth >= currentPeriodMonth) {
    throw new Error("Month can only be set for previous months. Current and future months update automatically.");
  }
  const normalizedCategoryName = payload.categoryName.trim();
  const expenseCategories = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    select: { id: true, name: true },
  });
  const existingCategory = expenseCategories.find(
    (category) => category.name.toLowerCase() === normalizedCategoryName.toLowerCase(),
  );
  const categoryId = existingCategory
    ? existingCategory.id
    : (
        await prisma.category.create({
          data: {
            userId: user.id,
            name: normalizedCategoryName,
            kind: CategoryKind.EXPENSE,
          },
        })
      ).id;

  await prisma.budget.upsert({
    where: {
      userId_categoryId_periodMonth: {
        userId: user.id,
        categoryId,
        periodMonth,
      },
    },
    update: {
      limitCents: toCents(payload.limit),
    },
    create: {
      userId: user.id,
      categoryId,
      periodMonth,
      limitCents: toCents(payload.limit),
    },
  });
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

export const updateBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const parsed = updateBudgetSchema.safeParse({
    budgetId: getFormValue(formData, "budgetId"),
    name: getFormValue(formData, "name"),
    limit: getFormValue(formData, "limit"),
  });
  if (!parsed.success) {
    throw new Error("Budget name and limit are required.");
  }
  const payload = parsed.data;

  const existing = await prisma.budget.findFirst({
    where: { id: payload.budgetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Budget not found.");

  await prisma.budget.update({
    where: { id: existing.id },
    data: {
      name: payload.name.trim(),
      limitCents: toCents(payload.limit),
    },
  });
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

export const deleteBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = deleteBudgetSchema.parse({
    budgetId: getFormValue(formData, "budgetId"),
  });

  const existing = await prisma.budget.findFirst({
    where: { id: payload.budgetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Budget not found.");

  await prisma.budget.delete({
    where: { id: existing.id },
  });
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Cover a category's current-month overage by pulling from other budgets: raise
 * the over-budget category's limit and lower each source's, all for the current
 * month (upserting current-month rows so history is untouched and the change
 * carries forward).
 */
export const reallocateBudgetAction = formAction(async (formData: FormData) => {
  const user = await requireUser();

  let transfers: unknown;
  try {
    transfers = JSON.parse(getFormValue(formData, "transfers") || "[]");
  } catch {
    throw new Error("Invalid reallocation request.");
  }

  const parsed = reallocateBudgetSchema.safeParse({
    destinationCategoryId: getFormValue(formData, "destinationCategoryId"),
    transfers,
  });
  if (!parsed.success) {
    throw new Error("Choose at least one budget and a positive amount to transfer.");
  }
  const payload = parsed.data;

  await reallocateBudgets(prisma, user, payload.destinationCategoryId, payload.transfers);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});


/**
 * Set the budgets "Suggest budgets" proposed and the person ticked, from the current month on
 * (earlier months keep what they had). A category's label carries over as reallocation does.
 */
export const applyBudgetSuggestionsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const parsed = applyBudgetSuggestionsSchema.safeParse(
    parseJsonField(getFormValue(formData, "budgets"), [], "Invalid budget suggestions."),
  );
  if (!parsed.success) throw new Error("Tick at least one budget to set.");
  await applyBudgetSuggestions(prisma, user, parsed.data);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});
