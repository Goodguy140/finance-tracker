import type { PrismaClient } from "@prisma/client";
import { TransactionType } from "@prisma/client";
import { endExclusiveOfMonthYm, startOfMonthYm } from "@/lib/dashboard-period";
import { percentUsed } from "@/lib/budget-alerts";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";

/** One budgeted category for a month: its limit and actual spend. */
export type BudgetProgressRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
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

/**
 * For each category, the most recent budget whose `periodMonth` is on/before `ym`.
 * Budgets carry forward until superseded, matching the dashboard's month view.
 */
export function selectActiveBudgetsByCategory<T extends { categoryId: string; periodMonth: string }>(
  budgets: T[],
  ym: string,
): Map<string, T> {
  const active = new Map<string, T>();
  for (const budget of budgets) {
    if (budget.periodMonth > ym) continue;
    const existing = active.get(budget.categoryId);
    if (!existing || budget.periodMonth > existing.periodMonth) {
      active.set(budget.categoryId, budget);
    }
  }
  return active;
}

type ActiveBudget = {
  id: string;
  categoryId: string;
  limitCents: number;
  category: { name: string };
};

/** Join active budgets with spend into sorted progress rows. */
export function buildBudgetProgressRows(
  activeBudgets: ActiveBudget[],
  spendByCategory: Map<string, number>,
): BudgetProgressRow[] {
  return activeBudgets
    .map((budget) => {
      const spentCents = spendByCategory.get(budget.categoryId) ?? 0;
      const limitCents = budget.limitCents;
      const progressPct = limitCents > 0 ? Math.min(Math.max((spentCents / limitCents) * 100, 0), 100) : 0;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        spentCents,
        limitCents,
        progressPct,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
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
  const rows = buildBudgetProgressRows(activeBudgets, spendByCategory);

  return {
    periodMonth: ym,
    currency,
    budgets: rows,
    totalLimitCents: rows.reduce((sum, row) => sum + row.limitCents, 0),
    totalSpentCents: rows.reduce((sum, row) => sum + row.spentCents, 0),
  };
}

/** Convenience for callers that want WaniKani-style percent without the row. */
export function budgetRowPercentUsed(row: BudgetProgressRow): number {
  return percentUsed(row.spentCents, row.limitCents);
}
