import { TransactionType, type PrismaClient } from "@prisma/client";
import { computeSpendByCategory } from "@/lib/budget-progress";
import { endExclusiveOfMonthYm } from "@/lib/dashboard-period";
import { dateFromYmd } from "@/lib/date-only";
import { inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";

/**
 * Yearly budgets, shown as sinking funds: a limit for the whole year in a category, of which a
 * twelfth is set aside each month. Spending in the category draws the fund down, so a $1,200
 * insurance bill paid in November finds $1,100 waiting by the end of October instead of
 * blowing that month's budget. Yearly budgets sit beside the monthly ones and are kept out of
 * monthly totals and alerts.
 */

/** The yearly budget in force for each category in `year`: the latest year on or before it. */
export function selectActiveYearlyBudgets<T extends { categoryId: string; year: number }>(
  rows: readonly T[],
  year: number,
): Map<string, T> {
  const active = new Map<string, T>();
  for (const row of rows) {
    if (row.year > year) continue;
    const existing = active.get(row.categoryId);
    if (!existing || row.year > existing.year) active.set(row.categoryId, row);
  }
  return active;
}

export type SinkingFundStatus = {
  /** A twelfth of the year's limit, the last month taking any rounding. */
  monthlyCents: number;
  /** What has been set aside from January through the month shown. */
  setAsideCents: number;
  /** Spent in the category this year, through the month shown. */
  spentCents: number;
  /** Set aside less spent: positive is waiting in the fund, negative is spent ahead of it. */
  fundCents: number;
  /** The year's limit less what is spent. */
  leftForYearCents: number;
};

/** The fund for a year's limit at the end of month `month` (1–12). */
export function sinkingFundStatus(limitCents: number, spentCents: number, month: number): SinkingFundStatus {
  const setAsideCents = Math.round((limitCents * month) / 12);
  return {
    monthlyCents: Math.round(limitCents / 12),
    setAsideCents,
    spentCents,
    fundCents: setAsideCents - spentCents,
    leftForYearCents: limitCents - spentCents,
  };
}

export type YearlyBudgetRow = SinkingFundStatus & {
  categoryId: string;
  categoryName: string;
  limitCents: number;
};

/**
 * Every category's yearly budget in force for `ym`'s year, with the fund at the end of `ym`.
 * Spending is the home currency's, as for monthly budgets.
 */
export async function loadYearlyBudgetRows(
  userId: string,
  ym: string,
  currency: string,
  client: PrismaClient = prisma,
): Promise<YearlyBudgetRow[]> {
  const year = Number(ym.slice(0, 4));
  const budgets = await client.yearlyBudget.findMany({
    where: { userId, year: { lte: year } },
    include: { category: { select: { name: true } } },
  });
  const active = [...selectActiveYearlyBudgets(budgets, year).values()];
  if (active.length === 0) return [];
  const categoryIds = active.map((b) => b.categoryId);
  const expenses = await client.transaction.findMany({
    where: {
      userId,
      type: TransactionType.EXPENSE,
      date: { gte: dateFromYmd(`${year}-01-01`), lt: endExclusiveOfMonthYm(ym) },
      AND: [
        { OR: [{ categoryId: { in: categoryIds } }, { splitParts: { some: { categoryId: { in: categoryIds } } } }] },
        inCurrencyWhere(currency),
      ],
    },
    select: { categoryId: true, amountCents: true, splitParts: { select: { categoryId: true, amountCents: true } } },
  });
  const spend = computeSpendByCategory(expenses);
  const month = Number(ym.slice(5, 7));
  return active
    .map((b) => ({
      categoryId: b.categoryId,
      categoryName: b.category.name,
      limitCents: b.limitCents,
      ...sinkingFundStatus(b.limitCents, spend.get(b.categoryId) ?? 0, month),
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}
