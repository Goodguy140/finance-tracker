import type { PrismaClient } from "@prisma/client";
import { TransactionType } from "@prisma/client";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { inCurrencyWhere } from "@/lib/home-currency";
import { ymdFromDateUtc } from "@/lib/date-only";

/**
 * Budget rollover, opt-in per expense category (`Category.rolloverSinceMonth`).
 *
 * From the month it was turned on, each month's budget minus that month's spend carries into
 * the next: what was left over adds to it, what went over comes off it. The carry into a month
 * is the running sum over every earlier month since then, so a surplus kept for months builds
 * up and an overspend is paid back by later months. Nothing before that month counts; turning
 * rollover off and on again starts afresh from the month it is turned back on.
 *
 * Everything that judges spend against a budget (the Budgets card, alerts, the score) adds the
 * carry to the month's limit; the stored `Budget.limitCents` stays the plain monthly amount.
 */

type RolloverBudget = { categoryId: string; periodMonth: string; limitCents: number };

/** `${ym}|${categoryId}` — the key for per-month, per-category figures. */
export function monthCategoryKey(ym: string, categoryId: string): string {
  return `${ym}|${categoryId}`;
}

/**
 * The carry into each month from `sinceYm + 1` through `throughYm` for one category, given
 * its budget rows and its spend by month. A month with no budget in force adds nothing.
 */
export function rolloverCarryByMonth(
  budgets: readonly RolloverBudget[],
  sinceYm: string,
  throughYm: string,
  spendByYm: ReadonlyMap<string, number>,
): Map<string, number> {
  const sorted = [...budgets].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  const carries = new Map<string, number>();
  let carry = 0;
  for (let ym = sinceYm; ym < throughYm; ym = shiftYm(ym, 1)) {
    // Budgets carry forward until superseded, as on the dashboard.
    let limit: number | null = null;
    for (const budget of sorted) {
      if (budget.periodMonth > ym) break;
      limit = budget.limitCents;
    }
    if (limit !== null) carry += limit - (spendByYm.get(ym) ?? 0);
    carries.set(shiftYm(ym, 1), carry);
  }
  return carries;
}

type ExpenseForRollover = {
  date: Date;
  categoryId: string;
  amountCents: number;
  splitParts: Array<{ categoryId: string; amountCents: number }>;
};

/** Spend per `${ym}|${categoryId}`, attributing split transactions to their parts. */
export function spendByMonthAndCategory(expenses: readonly ExpenseForRollover[]): Map<string, number> {
  const spend = new Map<string, number>();
  const add = (ym: string, categoryId: string, cents: number) => {
    const key = monthCategoryKey(ym, categoryId);
    spend.set(key, (spend.get(key) ?? 0) + cents);
  };
  for (const expense of expenses) {
    const ym = ymdFromDateUtc(expense.date).slice(0, 7);
    if (expense.splitParts.length > 0) {
      for (const part of expense.splitParts) add(ym, part.categoryId, part.amountCents);
    } else {
      add(ym, expense.categoryId, expense.amountCents);
    }
  }
  return spend;
}

/**
 * The carry into each of `yms` for every category with rollover on, keyed
 * `${ym}|${categoryId}`. Categories without rollover, and months on or before the one it was
 * turned on, have no entry (a carry of zero). Spend is the home currency's only, as budgets are.
 */
export async function loadRolloverCarries(
  client: PrismaClient,
  userId: string,
  currency: string,
  yms: readonly string[],
  budgets: readonly RolloverBudget[],
): Promise<Map<string, number>> {
  const carries = new Map<string, number>();
  if (yms.length === 0) return carries;
  const latestYm = yms.reduce((a, b) => (a > b ? a : b));
  const categories = await client.category.findMany({
    where: { userId, rolloverSinceMonth: { not: null, lt: latestYm } },
    select: { id: true, rolloverSinceMonth: true },
  });
  if (categories.length === 0) return carries;

  const ids = categories.map((c) => c.id);
  const earliest = categories.reduce((min, c) => (c.rolloverSinceMonth! < min ? c.rolloverSinceMonth! : min), latestYm);
  const expenses = await client.transaction.findMany({
    where: {
      userId,
      type: TransactionType.EXPENSE,
      date: { gte: startOfMonthYm(earliest), lt: startOfMonthYm(latestYm) },
      AND: [
        { OR: [{ categoryId: { in: ids } }, { splitParts: { some: { categoryId: { in: ids } } } }] },
        inCurrencyWhere(currency),
      ],
    },
    select: {
      date: true,
      categoryId: true,
      amountCents: true,
      splitParts: { select: { categoryId: true, amountCents: true } },
    },
  });
  const spend = spendByMonthAndCategory(expenses);

  for (const category of categories) {
    const spendByYm = new Map<string, number>();
    for (const [key, cents] of spend) {
      const [ym, categoryId] = key.split("|");
      if (categoryId === category.id) spendByYm.set(ym, cents);
    }
    const byMonth = rolloverCarryByMonth(
      budgets.filter((b) => b.categoryId === category.id),
      category.rolloverSinceMonth!,
      latestYm,
      spendByYm,
    );
    for (const ym of yms) {
      const carry = byMonth.get(ym);
      if (carry !== undefined) carries.set(monthCategoryKey(ym, category.id), carry);
    }
  }
  return carries;
}
