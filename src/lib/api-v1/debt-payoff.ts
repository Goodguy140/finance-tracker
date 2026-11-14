import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { formatYmLongLabel, shiftYm } from "@/lib/dashboard-period";
import { ymdFromDateUtc } from "@/lib/date-only";
import { PAYOFF_STRATEGIES, type DebtPayoffPlan } from "@/lib/debt-payoff-data";

/**
 * `GET /api/v1/debt-payoff?monthlyCents=`: the website's Debt payoff page (`/reports/debt`) for
 * the phone, from the same `loadDebtPayoff`. Every open card, loan and mortgage with what is
 * owed, its rate and minimum, and the three ways to pay them off for the monthly amount, each with
 * its debt-free month, interest and the order the debts go in.
 */
export function serializeDebtPayoff(plan: DebtPayoffPlan) {
  const monthLabel = (n: number) => formatYmLongLabel(shiftYm(plan.thisYm, n));
  return {
    currency: plan.currency,
    accounts: plan.liabilities.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      typeLabel: formatAccountTypeLabel(a.type),
      /** Yearly rate in basis points: 19.99% is 1999. Null until it is set. */
      interestRateBps: a.interestRateBps,
      minimumPaymentCents: a.minimumPaymentCents,
      /** Null when there is no balance in the home currency yet. */
      owed: a.owed ? { cents: a.owed.cents, date: ymdFromDateUtc(a.owed.date) } : null,
      /** A card's share of its limit in use; high over 30%. */
      utilization: a.utilization,
    })),
    /** Debts with no rate or minimum yet: counted as interest-free with no minimum. */
    missing: plan.missing,
    totalOwedCents: plan.totalOwedCents,
    minimumsCents: plan.minimumsCents,
    /** What the plans pay each month: the amount asked for, never less than the minimums. */
    monthlyCents: plan.monthlyCents,
    /** Highest rate first, smallest balance first, minimums only; empty plans when nothing is owed. */
    strategies: PAYOFF_STRATEGIES.map((s) => {
      const result = plan.results[s.id];
      return {
        id: s.id,
        label: s.label,
        hint: s.hint,
        /** Months until debt-free, 1 being next month; null when it never is at this amount. */
        months: result.months,
        debtFree: result.months === null ? null : monthLabel(result.months),
        totalInterestCents: result.totalInterestCents,
        payoffOrder: result.payoffOrder.map((p) => ({ id: p.id, name: p.name, month: p.month, label: monthLabel(p.month) })),
      };
    }),
  };
}

/** `?monthlyCents=` as a whole number of cents, or null for the minimums. */
export function monthlyCentsParam(value: string | null): number | null {
  return value && /^\d{1,12}$/.test(value) ? Number(value) : null;
}
