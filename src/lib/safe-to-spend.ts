/**
 * Safe to spend: one number for what is free to spend for the rest of the month.
 *
 *   income received this month − spent this month
 *   + income still expected (recurring and planned income due by month end)
 *   − bills still due (recurring and planned expenses due by month end, outside a budgeted category)
 *   − what is left in budgets (a budget's unspent remainder is already promised)
 *   − planned savings-goal contributions for the month
 *
 * A bill in a budgeted category is not subtracted on its own: the budget's remainder already
 * holds it, and counting both would take it twice.
 */
export type SafeToSpendRuleOccurrence = {
  type: "INCOME" | "EXPENSE";
  amountCents: number;
  categoryId: string;
  dateYmd: string;
};

export type SafeToSpendBudgetRow = { categoryId: string; limitCents: number; spentCents: number };

export type SafeToSpendInput = {
  todayYmd: string;
  incomeReceivedCents: number;
  spentCents: number;
  /** Unposted recurring occurrences and open plans from the start of the month on (overdue ones included). */
  occurrences: readonly SafeToSpendRuleOccurrence[];
  budgets: readonly SafeToSpendBudgetRow[];
  /** What each dated savings goal needs a month to make its date. */
  goalContributionsCents: readonly number[];
};

export type SafeToSpend = {
  safeCents: number;
  /** Safe-to-spend spread over the days left in the month, today included; 0 when negative. */
  perDayCents: number;
  daysLeft: number;
  incomeReceivedCents: number;
  spentCents: number;
  expectedIncomeCents: number;
  billsDueCents: number;
  budgetLeftCents: number;
  goalsCents: number;
};

export function daysLeftInMonth(todayYmd: string): number {
  const [y, m, d] = todayYmd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d + 1;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpend {
  const monthEnd = `${input.todayYmd.slice(0, 7)}-31`;
  const budgeted = new Set(input.budgets.filter((b) => b.limitCents > 0).map((b) => b.categoryId));
  let expectedIncomeCents = 0;
  let billsDueCents = 0;
  for (const o of input.occurrences) {
    if (o.dateYmd > monthEnd || o.dateYmd.slice(0, 7) !== input.todayYmd.slice(0, 7)) continue;
    if (o.type === "INCOME") expectedIncomeCents += o.amountCents;
    else if (!budgeted.has(o.categoryId)) billsDueCents += o.amountCents;
  }
  const budgetLeftCents = input.budgets.reduce((sum, b) => sum + Math.max(0, b.limitCents - b.spentCents), 0);
  const goalsCents = input.goalContributionsCents.reduce((sum, c) => sum + Math.max(0, c), 0);
  const safeCents =
    input.incomeReceivedCents - input.spentCents + expectedIncomeCents - billsDueCents - budgetLeftCents - goalsCents;
  const daysLeft = daysLeftInMonth(input.todayYmd);
  return {
    safeCents,
    perDayCents: safeCents > 0 ? Math.floor(safeCents / daysLeft) : 0,
    daysLeft,
    incomeReceivedCents: input.incomeReceivedCents,
    spentCents: input.spentCents,
    expectedIncomeCents,
    billsDueCents,
    budgetLeftCents,
    goalsCents,
  };
}
