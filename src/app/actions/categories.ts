"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, type Prisma } from "@prisma/client";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { positiveAmount } from "@/lib/validation";
import { isMappablePlaidCategory, plaidCategoryGroupOf } from "@/lib/plaid/category-taxonomy";
import { resuggestStagedCategories } from "@/lib/plaid/category-suggestions";
import { formAction, getFormValue } from "./_helpers";

/**
 * Category management: add, rename, merge, delete, the budget that goes with a category, and
 * which category each Plaid category lands in.
 *
 * Only expense and income categories are managed here. The one transfer category is the
 * app's own (see `ensureFallbackCategory`), and nothing should rename or remove it.
 */

const MAX_CATEGORY_NAME_LENGTH = 80;
const manageableKind = z.enum([CategoryKind.EXPENSE, CategoryKind.INCOME]);
const idSchema = z.string().min(1);

type Tx = Prisma.TransactionClient;

function normalizeName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a name for the category.");
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new Error(`Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
  }
  return name;
}

async function findManagedCategory(client: Tx | typeof prisma, userId: string, categoryId: string) {
  const category = await client.category.findFirst({
    where: { id: idSchema.parse(categoryId), userId, kind: { in: manageableKind.options } },
  });
  if (!category) throw new Error("Category not found.");
  return category;
}

/** Another category of the same kind whose name matches ignoring case, if any. */
async function findSameName(tx: Tx, userId: string, kind: CategoryKind, name: string, exceptId?: string) {
  const sameKind = await tx.category.findMany({ where: { userId, kind }, select: { id: true, name: true } });
  const key = name.toLowerCase();
  return sameKind.find((c) => c.id !== exceptId && c.name.toLowerCase() === key);
}

/**
 * Moves everything that points at `fromId` onto `toId`, then deletes `fromId`.
 *
 * Budgets: where both categories have a limit for the same month, the target's is kept —
 * merging is "this was always that", so the category being merged away gives up its own.
 * Every other month's limit moves across. Budget alert history for the old category is
 * dropped; the merged spend is judged against the target's limit from here on.
 */
async function mergeCategoryInto(tx: Tx, userId: string, fromId: string, toId: string) {
  const move = { where: { userId, categoryId: fromId }, data: { categoryId: toId } };
  await tx.transaction.updateMany(move);
  await tx.splitTransactionPart.updateMany(move);
  await tx.recurringTransaction.updateMany(move);
  await tx.plaidCategoryMapping.updateMany(move);
  await tx.plaidItem.updateMany({ where: { userId, defaultCategoryId: fromId }, data: { defaultCategoryId: toId } });
  await tx.transactionRule.updateMany({ where: { userId, setCategoryId: fromId }, data: { setCategoryId: toId } });
  await tx.plaidStagedTransaction.updateMany({
    where: { userId, suggestedCategoryId: fromId },
    data: { suggestedCategoryId: toId },
  });

  const [fromBudgets, toBudgets] = await Promise.all([
    tx.budget.findMany({ where: { userId, categoryId: fromId }, select: { id: true, periodMonth: true } }),
    tx.budget.findMany({ where: { userId, categoryId: toId }, select: { periodMonth: true } }),
  ]);
  const targetMonths = new Set(toBudgets.map((b) => b.periodMonth));
  const clashing = fromBudgets.filter((b) => targetMonths.has(b.periodMonth)).map((b) => b.id);
  if (clashing.length > 0) await tx.budget.deleteMany({ where: { id: { in: clashing } } });
  await tx.budget.updateMany(move);
  await tx.budgetAlertNotification.deleteMany({ where: { userId, categoryId: fromId } });

  await tx.category.delete({ where: { id: fromId } });
}

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
  const name = normalizeName(getFormValue(formData, "name"));
  const kind = manageableKind.parse(getFormValue(formData, "kind") || CategoryKind.EXPENSE);
  const rawLimit = getFormValue(formData, "limit").trim();
  const limitCents = rawLimit ? parseLimit(rawLimit) : null;
  if (limitCents !== null && kind !== CategoryKind.EXPENSE) {
    throw new Error("Budgets apply to expense categories only.");
  }

  await prisma.$transaction(async (tx) => {
    if (await findSameName(tx, user.id, kind, name)) {
      throw new Error(`You already have a category called “${name}”.`);
    }
    const created = await tx.category.create({ data: { userId: user.id, name, kind }, select: { id: true } });
    if (limitCents !== null) {
      await tx.budget.create({
        data: {
          userId: user.id,
          categoryId: created.id,
          periodMonth: currentYmInTimeZone(user.timezone),
          limitCents,
        },
      });
    }
  });
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
  const name = normalizeName(getFormValue(formData, "name"));
  await prisma.$transaction(async (tx) => {
    const category = await findManagedCategory(tx, user.id, getFormValue(formData, "categoryId"));
    const other = await findSameName(tx, user.id, category.kind, name, category.id);
    if (other) {
      await mergeCategoryInto(tx, user.id, category.id, other.id);
      return;
    }
    await tx.category.update({ where: { id: category.id }, data: { name } });
  });
  await afterCategoryChange(user);
});

/** Merges one category into another of the same kind. */
export const mergeCategoryAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await prisma.$transaction(async (tx) => {
    const from = await findManagedCategory(tx, user.id, getFormValue(formData, "categoryId"));
    const to = await findManagedCategory(tx, user.id, getFormValue(formData, "targetCategoryId"));
    if (from.id === to.id) throw new Error("Pick a different category to merge into.");
    if (from.kind !== to.kind) throw new Error("Expense and income categories cannot be merged.");
    await mergeCategoryInto(tx, user.id, from.id, to.id);
  });
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
  await prisma.$transaction(async (tx) => {
    const category = await findManagedCategory(tx, user.id, getFormValue(formData, "categoryId"));
    const remaining = await tx.category.count({ where: { userId: user.id, kind: category.kind } });
    if (remaining <= 1) {
      throw new Error(`Keep at least one ${category.kind === CategoryKind.INCOME ? "income" : "expense"} category.`);
    }
    if (targetId) {
      const target = await findManagedCategory(tx, user.id, targetId);
      if (target.id === category.id) throw new Error("Pick a different category to move its transactions to.");
      if (target.kind !== category.kind) throw new Error("Expense and income categories cannot be merged.");
      await mergeCategoryInto(tx, user.id, category.id, target.id);
      return;
    }
    const [transactions, splitParts, recurring] = await Promise.all([
      tx.transaction.count({ where: { userId: user.id, categoryId: category.id } }),
      tx.splitTransactionPart.count({ where: { userId: user.id, categoryId: category.id } }),
      tx.recurringTransaction.count({ where: { userId: user.id, categoryId: category.id } }),
    ]);
    if (transactions + splitParts + recurring > 0) {
      throw new Error("This category is in use. Choose a category to move its transactions to.");
    }
    await tx.budget.deleteMany({ where: { userId: user.id, categoryId: category.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId: user.id, categoryId: category.id } });
    await tx.category.delete({ where: { id: category.id } });
  });
  await afterCategoryChange(user);
});

function parseLimit(raw: string): number {
  const parsed = positiveAmount.safeParse(raw.replace(/[$,\s]/g, ""));
  if (!parsed.success) throw new Error("Enter a monthly limit above zero.");
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
  const category = await findManagedCategory(prisma, user.id, getFormValue(formData, "categoryId"));
  if (category.kind !== CategoryKind.EXPENSE) throw new Error("Budgets apply to expense categories only.");
  if (getFormValue(formData, "intent") === "remove") {
    // Rollover goes with the budget: one added later starts with nothing carried.
    await prisma.$transaction([
      prisma.budget.deleteMany({ where: { userId: user.id, categoryId: category.id } }),
      prisma.category.update({ where: { id: category.id }, data: { rolloverSinceMonth: null } }),
    ]);
  } else {
    const limitCents = parseLimit(getFormValue(formData, "limit").trim());
    const periodMonth = currentYmInTimeZone(user.timezone);
    await prisma.budget.upsert({
      where: { userId_categoryId_periodMonth: { userId: user.id, categoryId: category.id, periodMonth } },
      update: { limitCents },
      create: { userId: user.id, categoryId: category.id, periodMonth, limitCents },
    });
  }
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
  const category = await findManagedCategory(prisma, user.id, getFormValue(formData, "categoryId"));
  if (category.kind !== CategoryKind.EXPENSE) throw new Error("Budgets apply to expense categories only.");
  const enabled = getFormValue(formData, "enabled") === "true";
  if (enabled) {
    const hasBudget = await prisma.budget.count({ where: { userId: user.id, categoryId: category.id } });
    if (hasBudget === 0) throw new Error("Set a monthly budget before turning on rollover.");
    await prisma.category.updateMany({
      where: { id: category.id, rolloverSinceMonth: null },
      data: { rolloverSinceMonth: currentYmInTimeZone(user.timezone) },
    });
  } else {
    await prisma.category.update({ where: { id: category.id }, data: { rolloverSinceMonth: null } });
  }
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/**
 * Says which category a Plaid category lands in, or (empty `categoryId`) returns it to the
 * built-in default. Rows still waiting in the review queue are re-suggested at once.
 */
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
