import { TransactionType, type PrismaClient } from "@prisma/client";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import {
  buildBudgetProgressRows,
  carriesForMonth,
  computeSpendByCategory,
  selectActiveBudgetsByCategory,
} from "@/lib/budget-progress";
import { loadRolloverCarries } from "@/lib/budget-rollover";
import { endExclusiveOfMonthYm, startOfMonthYm } from "@/lib/dashboard-period";
import { ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { computeSafeToSpend, daysLeftInMonth, type SafeToSpend } from "@/lib/safe-to-spend";
import type { ZeroBasedInput } from "@/lib/zero-based";

type SafeToSpendUser = { id: string; countryCode: string | null; timezone: string | null };

/** Safe to spend for the month now running, in the user's home currency. */
export async function loadSafeToSpend(
  user: SafeToSpendUser,
  now: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<SafeToSpend> {
  return computeSafeToSpend(await loadSafeToSpendInput(user, now, client));
}

/** What Safe to spend and zero-based budgeting are worked out from, for the month now running. */
export async function loadSafeToSpendInput(
  user: SafeToSpendUser,
  now: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<ZeroBasedInput> {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const ym = todayYmd.slice(0, 7);
  const monthRange = { gte: startOfMonthYm(ym), lt: endExclusiveOfMonthYm(ym) };
  const [expenses, income, budgets, rules, goals] = await Promise.all([
    client.transaction.findMany({
      where: { userId: user.id, type: TransactionType.EXPENSE, date: monthRange, ...inCurrencyWhere(currency) },
      select: { categoryId: true, amountCents: true, splitParts: { select: { categoryId: true, amountCents: true } } },
    }),
    client.transaction.aggregate({
      where: { userId: user.id, type: TransactionType.INCOME, date: monthRange, ...inCurrencyWhere(currency) },
      _sum: { amountCents: true },
    }),
    client.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: { updatedAt: "desc" } }),
    client.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true, account: { currency } },
      select: {
        type: true,
        amountCents: true,
        categoryId: true,
        cadence: true,
        nextExpectedDate: true,
        anchorDay: true,
        endDate: true,
        enabled: true,
      },
    }),
    loadSavingsGoals({ id: user.id, timezone: user.timezone, countryCode: user.countryCode }),
  ]);

  const spendByCategory = computeSpendByCategory(expenses);
  const active = Array.from(selectActiveBudgetsByCategory(budgets, ym).values());
  const carries = carriesForMonth(await loadRolloverCarries(client, user.id, currency, [ym], budgets), ym);
  const budgetRows = buildBudgetProgressRows(active, spendByCategory, carries);
  const forecast = forecastRecurringOccurrences(rules, { todayYmd, currentYm: ym, days: daysLeftInMonth(todayYmd) });

  return {
    todayYmd,
    incomeReceivedCents: income._sum.amountCents ?? 0,
    spentCents: expenses.reduce((sum, e) => sum + e.amountCents, 0),
    occurrences: forecast.occurrences.map((o) => ({
      type: o.rule.type === TransactionType.INCOME ? "INCOME" : "EXPENSE",
      amountCents: o.rule.amountCents,
      categoryId: o.rule.categoryId,
      dateYmd: ymdFromDateUtc(o.date),
    })),
    budgets: budgetRows,
    goalContributionsCents: goals.goals
      .filter((g) => g.currency === currency)
      .flatMap((g) => (g.progress.monthlyNeededCents ? [g.progress.monthlyNeededCents] : [])),
  };
}
