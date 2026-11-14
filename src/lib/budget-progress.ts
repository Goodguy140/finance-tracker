import type { PrismaClient } from "@prisma/client";
import { TransactionType } from "@prisma/client";
import { endExclusiveOfMonthYm, startOfMonthYm } from "@/lib/dashboard-period";
import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { percentUsed } from "@/lib/budget-alerts";
import { loadRolloverCarries } from "@/lib/budget-rollover";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";

/** One budgeted category for a month: its limit and actual spend. */
export type BudgetProgressRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  spentCents: number;
  /** What this month's spend is judged against: the monthly budget plus any rollover carry. */
  limitCents: number;
  /** The monthly budget as set, before rollover. */
  baseLimitCents: number;
  /** Carried in from earlier months by rollover: positive left over, negative overspent. */
  carryCents: number;
  /** Spend ÷ limit as 0–100 (clamped), for progress bars. */
  progressPct: number;
};

export type MonthlyBudgetProgress = {
  periodMonth: string;
  currency: string;
  budgets: BudgetProgressRow[];
  totalLimitCents: number;
  totalSpentCents: number;
};

type ExpenseForSpend = {
  categoryId: string;
  amountCents: number;
  splitParts: Array<{ categoryId: string; amountCents: number }>;
};

/** Sum expenses per category, attributing split transactions to their parts. */
export function computeSpendByCategory(expenses: ExpenseForSpend[]): Map<string, number> {
  const spendByCategory = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.splitParts.length > 0) {
      for (const part of expense.splitParts) {
        spendByCategory.set(part.categoryId, (spendByCategory.get(part.categoryId) ?? 0) + part.amountCents);
      }
      continue;
    }
    spendByCategory.set(expense.categoryId, (spendByCategory.get(expense.categoryId) ?? 0) + expense.amountCents);
  }
  return spendByCategory;
}

export { selectActiveBudgetsByCategory };

type ActiveBudget = {
  id: string;
  categoryId: string;
  limitCents: number;
  category: { name: string };
};

/** Spend ÷ limit as 0–100 for a bar; full when anything is spent against a limit of zero or less. */
export function budgetProgressPct(spentCents: number, limitCents: number): number {
  if (limitCents <= 0) return spentCents > 0 ? 100 : 0;
  return Math.min(Math.max((spentCents / limitCents) * 100, 0), 100);
}

/**
 * Join active budgets with spend into sorted progress rows. `carryByCategory` is the month's
 * rollover carry per category (`loadRolloverCarries`, narrowed to the month); none by default.
 */
export function buildBudgetProgressRows(
  activeBudgets: ActiveBudget[],
  spendByCategory: Map<string, number>,
  carryByCategory: ReadonlyMap<string, number> = new Map(),
): BudgetProgressRow[] {
  return activeBudgets
    .map((budget) => {
      const spentCents = spendByCategory.get(budget.categoryId) ?? 0;
      const carryCents = carryByCategory.get(budget.categoryId) ?? 0;
      const limitCents = budget.limitCents + carryCents;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        spentCents,
        limitCents,
        baseLimitCents: budget.limitCents,
        carryCents,
        progressPct: budgetProgressPct(spentCents, limitCents),
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/**
 * Budgets against spending over several months (year to date, a custom range, all time): each
 * category's limit is the budget in force in each month of `months`, added up, since a budget
 * carries forward until it is changed just as in a month view; its spending is the whole range's.
 * Categories with spending and no budget are listed with a limit of zero. No rollover: summed over
 * the months, the limits already net what one month leaves for the next.
 */
export function buildRangeBudgetProgressRows(
  budgets: readonly { categoryId: string; periodMonth: string; limitCents: number; category: { name: string } }[],
  spendByCategory: ReadonlyMap<string, number>,
  months: readonly string[],
  categoryName: (categoryId: string) => string,
): BudgetProgressRow[] {
  const limitSumByCategory = new Map<string, number>();
  const nameByCategory = new Map<string, string>();
  for (const ym of months) {
    for (const budget of selectActiveBudgetsByCategory(budgets, ym).values()) {
      limitSumByCategory.set(budget.categoryId, (limitSumByCategory.get(budget.categoryId) ?? 0) + budget.limitCents);
      if (!nameByCategory.has(budget.categoryId)) nameByCategory.set(budget.categoryId, budget.category.name);
    }
  }
  const categoryIds = new Set([...limitSumByCategory.keys(), ...spendByCategory.keys()]);
  return Array.from(categoryIds)
    .map((categoryId) => {
      const limitCents = limitSumByCategory.get(categoryId) ?? 0;
      const spentCents = spendByCategory.get(categoryId) ?? 0;
      return {
        id: categoryId,
        categoryId,
        categoryName: nameByCategory.get(categoryId) ?? categoryName(categoryId),
        spentCents,
        limitCents,
        baseLimitCents: limitCents,
        carryCents: 0,
        progressPct: limitCents > 0 ? Math.min(Math.max((spentCents / limitCents) * 100, 0), 100) : 0,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/**
 * Budgets against spending from `from` to before `to` in the home currency, added up over
 * `months` (`buildRangeBudgetProgressRows`), for the phone's year to date and custom ranges. Only
 * budgeted categories, as a month's progress lists them. `periodMonth` is the range's last month.
 */
export async function buildRangeBudgetProgress(
  userId: string,
  range: { gte: Date; lt: Date },
  months: readonly string[],
  client: PrismaClient = prisma,
): Promise<MonthlyBudgetProgress> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { countryCode: true } });
  const currency = homeCurrencyOf(user?.countryCode);
  const [budgets, periodExpenses] = await Promise.all([
    client.budget.findMany({ where: { userId }, include: { category: true } }),
    client.transaction.findMany({
      where: { userId, type: TransactionType.EXPENSE, date: range, ...inCurrencyWhere(currency) },
      select: { categoryId: true, amountCents: true, splitParts: { select: { categoryId: true, amountCents: true } } },
    }),
  ]);
  const rows = buildRangeBudgetProgressRows(budgets, computeSpendByCategory(periodExpenses), months, () => "Unknown").filter(
    (row) => row.limitCents > 0,
  );
  return {
    periodMonth: months[months.length - 1],
    currency,
    budgets: rows,
    totalLimitCents: rows.reduce((sum, row) => sum + row.limitCents, 0),
    totalSpentCents: rows.reduce((sum, row) => sum + row.spentCents, 0),
  };
}

/**
 * Current-month budget-vs-actual for a user, ready to serialize over the API.
 * Self-contained (fetches its own data) so route handlers can call it directly;
 * the dashboard page reuses the pure helpers above with its already-loaded data.
 */
export async function buildMonthlyBudgetProgress(
  userId: string,
  ym: string,
  client: PrismaClient = prisma,
): Promise<MonthlyBudgetProgress> {
  // Budgets are in the user's home currency; spending on an account in another one can't be
  // added to them without a conversion this app doesn't do.
  const user = await client.user.findUnique({ where: { id: userId }, select: { countryCode: true } });
  const currency = homeCurrencyOf(user?.countryCode);
  const [budgets, periodExpenses] = await Promise.all([
    client.budget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    }),
    client.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        date: { gte: startOfMonthYm(ym), lt: endExclusiveOfMonthYm(ym) },
        ...inCurrencyWhere(currency),
      },
      select: {
        categoryId: true,
        amountCents: true,
        splitParts: { select: { categoryId: true, amountCents: true } },
      },
    }),
  ]);

  const spendByCategory = computeSpendByCategory(periodExpenses);
  const activeBudgets = Array.from(selectActiveBudgetsByCategory(budgets, ym).values());
  const carryByCategory = carriesForMonth(await loadRolloverCarries(client, userId, currency, [ym], budgets), ym);
  const rows = buildBudgetProgressRows(activeBudgets, spendByCategory, carryByCategory);

  return {
    periodMonth: ym,
    currency,
    budgets: rows,
    totalLimitCents: rows.reduce((sum, row) => sum + row.limitCents, 0),
    totalSpentCents: rows.reduce((sum, row) => sum + row.spentCents, 0),
  };
}

/** One month's entries from `loadRolloverCarries`, keyed by category. */
export function carriesForMonth(carries: ReadonlyMap<string, number>, ym: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, cents] of carries) {
    const [keyYm, categoryId] = key.split("|");
    if (keyYm === ym) out.set(categoryId, cents);
  }
  return out;
}

/** Convenience for callers that want WaniKani-style percent without the row. */
export function budgetRowPercentUsed(row: BudgetProgressRow): number {
  return percentUsed(row.spentCents, row.limitCents);
}
