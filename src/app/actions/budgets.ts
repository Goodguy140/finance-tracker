"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind } from "@prisma/client";
import { toCents } from "@/lib/money";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { computeReallocationPlan } from "@/lib/budget-reallocation";
import { requireUser } from "@/lib/session";
import {
  budgetSchema,
  deleteBudgetSchema,
  reallocateBudgetSchema,
  updateBudgetSchema,
} from "@/lib/validation";
import {
  getFormValue,
  formAction,
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

  // Period is derived server-side; the client cannot reallocate a past month.
  const periodMonth = currentYmInTimeZone(user.timezone);
  const progress = await buildMonthlyBudgetProgress(user.id, periodMonth);

  // The plan works on what each budget has this month, rollover carry included; what is
  // stored is the monthly budget, so the carry comes back off before saving.
  const carryByCategory = new Map(progress.budgets.map((row) => [row.categoryId, row.carryCents]));
  const updates = computeReallocationPlan(
    progress.budgets,
    payload.destinationCategoryId,
    payload.transfers,
  ).map((update) => ({ ...update, newLimitCents: update.newLimitCents - (carryByCategory.get(update.categoryId) ?? 0) }));
  // A surplus carried in can be spent but not moved: it would leave a monthly budget below zero.
  const belowZero = updates.find((update) => update.newLimitCents < 0);
  if (belowZero) {
    const row = progress.budgets.find((b) => b.categoryId === belowZero.categoryId);
    throw new Error(
      `${row?.categoryName ?? "That budget"} can give at most ${((row?.baseLimitCents ?? 0) / 100).toFixed(2)} this month.`,
    );
  }

  // Preserve any carried-forward label when creating a fresh current-month row.
  const affectedCategoryIds = updates.map((update) => update.categoryId);
  const priorBudgets = await prisma.budget.findMany({
    where: {
      userId: user.id,
      categoryId: { in: affectedCategoryIds },
      periodMonth: { lte: periodMonth },
    },
    orderBy: { periodMonth: "desc" },
    select: { categoryId: true, name: true },
  });
  const nameByCategory = new Map<string, string | null>();
  for (const budget of priorBudgets) {
    if (!nameByCategory.has(budget.categoryId)) nameByCategory.set(budget.categoryId, budget.name);
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.budget.upsert({
        where: {
          userId_categoryId_periodMonth: {
            userId: user.id,
            categoryId: update.categoryId,
            periodMonth,
          },
        },
        update: { limitCents: update.newLimitCents },
        create: {
          userId: user.id,
          categoryId: update.categoryId,
          periodMonth,
          limitCents: update.newLimitCents,
          name: nameByCategory.get(update.categoryId) ?? null,
        },
      }),
    ),
  );

  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

