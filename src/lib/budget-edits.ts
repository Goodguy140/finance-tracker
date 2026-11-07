import { CategoryKind, type PrismaClient } from "@prisma/client";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { computeReallocationPlan, type ReallocationTransfer } from "@/lib/budget-reallocation";
import { currentYmInTimeZone } from "@/lib/period-month";

/**
 * Budget changes shared by the website (Settings → Categories, the Budgets card's reallocate
 * dialog) and the phone, so both write the same rows: a monthly or yearly budget set from this
 * month or year on, rollover from this month, and an overage covered from other budgets this month.
 */

export class BudgetEditError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "BudgetEditError";
  }
}

type User = { id: string; timezone: string };

/** The user's expense category, the only kind with a budget. @throws BudgetEditError */
export async function findBudgetCategory(db: PrismaClient, userId: string, categoryId: string) {
  const category = await db.category.findFirst({
    where: { id: categoryId, userId, kind: { in: [CategoryKind.EXPENSE, CategoryKind.INCOME] } },
    select: { id: true, kind: true },
  });
  if (!category) throw new BudgetEditError("Category not found.", true);
  if (category.kind !== CategoryKind.EXPENSE) throw new BudgetEditError("Budgets apply to expense categories only.");
  return category;
}

/**
 * Sets a category's monthly budget from this month on, or removes it (`null`).
 *
 * Setting writes this month's row, which rolls forward; earlier months keep the limits they had.
 * Removing deletes every budget row the category has, past months included — "no budget" has no
 * row of its own to mean it, so leaving an older rolling row would quietly bring the old limit
 * back. Rollover goes with the budget: one added later starts with nothing carried.
 */
export async function setMonthlyBudget(db: PrismaClient, user: User, categoryId: string, limitCents: number | null) {
  const category = await findBudgetCategory(db, user.id, categoryId);
  if (limitCents === null) {
    await db.$transaction([
      db.budget.deleteMany({ where: { userId: user.id, categoryId: category.id } }),
      db.category.update({ where: { id: category.id }, data: { rolloverSinceMonth: null } }),
    ]);
    return;
  }
  const periodMonth = currentYmInTimeZone(user.timezone);
  await db.budget.upsert({
    where: { userId_categoryId_periodMonth: { userId: user.id, categoryId: category.id, periodMonth } },
    update: { limitCents },
    create: { userId: user.id, categoryId: category.id, periodMonth, limitCents },
  });
}

/**
 * Turns budget rollover on or off. On, it counts from this month: this month's leftover (or
 * overspend) is the first to carry into the next. Turning it on again while on keeps the original
 * month, so a double submit does not throw away what has built up. Off forgets it.
 */
export async function setBudgetRollover(db: PrismaClient, user: User, categoryId: string, enabled: boolean) {
  const category = await findBudgetCategory(db, user.id, categoryId);
  if (!enabled) {
    await db.category.update({ where: { id: category.id }, data: { rolloverSinceMonth: null } });
    return;
  }
  const hasBudget = await db.budget.count({ where: { userId: user.id, categoryId: category.id } });
  if (hasBudget === 0) throw new BudgetEditError("Set a monthly budget before turning on rollover.");
  await db.category.updateMany({
    where: { id: category.id, rolloverSinceMonth: null },
    data: { rolloverSinceMonth: currentYmInTimeZone(user.timezone) },
  });
}

/** Sets a category's yearly budget from this year on, or removes it (`null`, every year). */
export async function setYearlyBudget(db: PrismaClient, user: User, categoryId: string, limitCents: number | null) {
  const category = await findBudgetCategory(db, user.id, categoryId);
  if (limitCents === null) {
    await db.yearlyBudget.deleteMany({ where: { userId: user.id, categoryId: category.id } });
    return;
  }
  const year = Number(currentYmInTimeZone(user.timezone).slice(0, 4));
  await db.yearlyBudget.upsert({
    where: { userId_categoryId_year: { userId: user.id, categoryId: category.id, year } },
    update: { limitCents },
    create: { userId: user.id, categoryId: category.id, year, limitCents },
  });
}

/**
 * Covers a category's overage this month by taking from other budgets' room: raises its limit and
 * lowers each source's, all for the current month (upserting this month's rows, so history is
 * untouched and the change carries forward). @throws BudgetEditError
 */
export async function reallocateBudgets(
  db: PrismaClient,
  user: User,
  destinationCategoryId: string,
  transfers: ReallocationTransfer[],
) {
  // Never a past month: the period is the user's own this month.
  const periodMonth = currentYmInTimeZone(user.timezone);
  const progress = await buildMonthlyBudgetProgress(user.id, periodMonth, db);

  // The plan works on what each budget has this month, rollover carry included; what is
  // stored is the monthly budget, so the carry comes back off before saving.
  const carryByCategory = new Map(progress.budgets.map((row) => [row.categoryId, row.carryCents]));
  let plan: ReturnType<typeof computeReallocationPlan>;
  try {
    plan = computeReallocationPlan(progress.budgets, destinationCategoryId, transfers);
  } catch (err) {
    // Every refusal the planner makes is about the request, worded for the person.
    throw new BudgetEditError(err instanceof Error ? err.message : "That move can't be made.");
  }
  const updates = plan.map((update) => ({
    ...update,
    newLimitCents: update.newLimitCents - (carryByCategory.get(update.categoryId) ?? 0),
  }));
  // A surplus carried in can be spent but not moved: it would leave a monthly budget below zero.
  const belowZero = updates.find((update) => update.newLimitCents < 0);
  if (belowZero) {
    const row = progress.budgets.find((b) => b.categoryId === belowZero.categoryId);
    throw new BudgetEditError(
      `${row?.categoryName ?? "That budget"} can give at most ${((row?.baseLimitCents ?? 0) / 100).toFixed(2)} this month.`,
    );
  }

  // Preserve any carried-forward label when creating a fresh current-month row.
  const affectedCategoryIds = updates.map((update) => update.categoryId);
  const priorBudgets = await db.budget.findMany({
    where: { userId: user.id, categoryId: { in: affectedCategoryIds }, periodMonth: { lte: periodMonth } },
    orderBy: { periodMonth: "desc" },
    select: { categoryId: true, name: true },
  });
  const nameByCategory = new Map<string, string | null>();
  for (const budget of priorBudgets) {
    if (!nameByCategory.has(budget.categoryId)) nameByCategory.set(budget.categoryId, budget.name);
  }

  await db.$transaction(
    updates.map((update) =>
      db.budget.upsert({
        where: { userId_categoryId_periodMonth: { userId: user.id, categoryId: update.categoryId, periodMonth } },
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
}
