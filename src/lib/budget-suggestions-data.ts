import { CategoryKind, TransactionType } from "@prisma/client";
import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import {
  SUGGESTION_WINDOWS,
  suggestBudgets,
  suggestionMonths,
  type BudgetSuggestionSet,
} from "@/lib/budget-suggestions";
import { inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import { loadReportTxs } from "@/lib/reports/load";

/** Budget suggestions from the last 3 and the last 6 full months before `currentYm`. */
export async function loadBudgetSuggestions(
  userId: string,
  currency: string,
  currentYm: string,
): Promise<BudgetSuggestionSet[]> {
  const longest = Math.max(...SUGGESTION_WINDOWS);
  const [first, categories, budgets, txs] = await Promise.all([
    prisma.transaction.findFirst({
      where: { userId, type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] }, ...inCurrencyWhere(currency) },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.category.findMany({
      where: { userId, kind: CategoryKind.EXPENSE },
      select: { id: true, name: true },
    }),
    prisma.budget.findMany({ where: { userId }, select: { categoryId: true, periodMonth: true, limitCents: true } }),
    loadReportTxs(userId, startOfMonthYm(shiftYm(currentYm, -longest)), currency),
  ]);
  const firstYm = first ? first.date.toISOString().slice(0, 7) : null;
  const currentLimits = new Map(
    [...selectActiveBudgetsByCategory(budgets, currentYm)].map(([categoryId, b]) => [categoryId, b.limitCents]),
  );
  return SUGGESTION_WINDOWS.map((window) =>
    suggestBudgets({ window, months: suggestionMonths(currentYm, window, firstYm), txs, categories, currentLimits }),
  );
}
