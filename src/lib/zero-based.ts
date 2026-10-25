import type { SafeToSpendInput } from "@/lib/safe-to-spend";

/**
 * Zero-based budgeting ("give every dollar a job"), worked out from the same inputs as Safe to spend.
 *
 *   to assign = income received + income still expected this month
 *             − assigned to budgets this month (each budget as set, before rollover)
 *             − bills still due outside a budgeted category
 *             − spending so far outside a budgeted category
 *             − planned savings-goal contributions
 *
 * Rollover carries are left out of "assigned": a carry is money assigned in an earlier month,
 * not a claim on this month's income. A budget that is overspent (past its limit with the carry
 * included) must be covered by moving money from another budget; that total is shown apart.
 */
export type ZeroBasedBudgetRow = {
  categoryId: string;
  categoryName?: string;
  limitCents: number;
  spentCents: number;
  /** The budget as set for the month, before rollover; falls back to `limitCents`. */
  baseLimitCents?: number;
};

export type ZeroBasedInput = Omit<SafeToSpendInput, "budgets"> & { budgets: readonly ZeroBasedBudgetRow[] };

export type ZeroBasedSummary = {
  toAssignCents: number;
  incomeCents: number;
  assignedCents: number;
  billsOutsideBudgetsCents: number;
  spentOutsideBudgetsCents: number;
  goalsCents: number;
  overspent: Array<{ categoryId: string; categoryName: string; overCents: number }>;
  overspentCents: number;
};

export function computeZeroBased(input: ZeroBasedInput): ZeroBasedSummary {
  const ym = input.todayYmd.slice(0, 7);
  const budgeted = new Set(input.budgets.filter((b) => b.limitCents > 0).map((b) => b.categoryId));
  let expectedIncomeCents = 0;
  let billsOutsideBudgetsCents = 0;
  for (const o of input.occurrences) {
    if (o.dateYmd.slice(0, 7) !== ym) continue;
    if (o.type === "INCOME") expectedIncomeCents += o.amountCents;
    else if (!budgeted.has(o.categoryId)) billsOutsideBudgetsCents += o.amountCents;
  }
  const assignedCents = input.budgets.reduce((sum, b) => sum + Math.max(0, b.baseLimitCents ?? b.limitCents), 0);
  const spentInBudgets = input.budgets
    .filter((b) => budgeted.has(b.categoryId))
    .reduce((sum, b) => sum + b.spentCents, 0);
  const spentOutsideBudgetsCents = Math.max(0, input.spentCents - spentInBudgets);
  const goalsCents = input.goalContributionsCents.reduce((sum, c) => sum + Math.max(0, c), 0);
  const incomeCents = input.incomeReceivedCents + expectedIncomeCents;
  const overspent = input.budgets
    .filter((b) => b.spentCents > b.limitCents)
    .map((b) => ({ categoryId: b.categoryId, categoryName: b.categoryName ?? "Budget", overCents: b.spentCents - b.limitCents }))
    .sort((a, b) => b.overCents - a.overCents);
  return {
    toAssignCents: incomeCents - assignedCents - billsOutsideBudgetsCents - spentOutsideBudgetsCents - goalsCents,
    incomeCents,
    assignedCents,
    billsOutsideBudgetsCents,
    spentOutsideBudgetsCents,
    goalsCents,
    overspent,
    overspentCents: overspent.reduce((sum, o) => sum + o.overCents, 0),
  };
}
