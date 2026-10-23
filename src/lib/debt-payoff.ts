/**
 * Paying off credit cards and loans: month by month, interest is added to each balance, every
 * debt gets its minimum, and whatever is left of the monthly amount goes to one debt at a time:
 * the highest rate first (avalanche, the least interest) or the smallest balance first
 * (snowball, the quickest wins). A paid-off debt's minimum then rolls into the next, because the
 * monthly amount stays the same. "Minimums only" pays just the minimums, for comparison.
 *
 * Pure: balances, rates and minimums in, months and interest out.
 */

export type Debt = {
  id: string;
  name: string;
  balanceCents: number;
  /** Yearly rate in basis points: 19.99% is 1999. */
  aprBps: number;
  minimumCents: number;
};

export type PayoffStrategy = "avalanche" | "snowball" | "minimums";

export type PayoffResult = {
  strategy: PayoffStrategy;
  /** Months until every debt is paid off; null when it never is (payments do not beat interest). */
  months: number | null;
  totalInterestCents: number;
  totalPaidCents: number;
  /** The month (1 = next month) each debt is paid off in, in the order they go. */
  payoffOrder: Array<{ id: string; name: string; month: number }>;
};

/** Long enough for a 30-year loan; past it the plan is reported as never finishing. */
export const MAX_PAYOFF_MONTHS = 600;

function targetOrder(debts: Debt[], strategy: PayoffStrategy): Debt[] {
  const sorted = [...debts];
  if (strategy === "avalanche") sorted.sort((a, b) => b.aprBps - a.aprBps || a.balanceCents - b.balanceCents);
  else sorted.sort((a, b) => a.balanceCents - b.balanceCents || b.aprBps - a.aprBps);
  return sorted;
}

export function minimumsTotal(debts: readonly Debt[]): number {
  return debts.filter((d) => d.balanceCents > 0).reduce((sum, d) => sum + d.minimumCents, 0);
}

export function simulatePayoff(debts: readonly Debt[], monthlyCents: number, strategy: PayoffStrategy): PayoffResult {
  const owing = debts.filter((d) => d.balanceCents > 0);
  const order = targetOrder(owing, strategy);
  const balance = new Map(owing.map((d) => [d.id, d.balanceCents]));
  // Never less than the minimums: the plan cannot pay less than the lenders require.
  const budget = Math.max(monthlyCents, minimumsTotal(owing));
  const payoffOrder: PayoffResult["payoffOrder"] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= MAX_PAYOFF_MONTHS; month++) {
    const before = [...balance.values()].reduce((a, b) => a + b, 0);
    if (before <= 0) break;

    for (const d of owing) {
      const b = balance.get(d.id)!;
      if (b <= 0) continue;
      const interest = Math.round((b * d.aprBps) / 10_000 / 12);
      balance.set(d.id, b + interest);
      totalInterest += interest;
    }

    let left = strategy === "minimums" ? Infinity : budget;
    for (const d of owing) {
      const b = balance.get(d.id)!;
      if (b <= 0) continue;
      const pay = Math.min(b, d.minimumCents, left);
      balance.set(d.id, b - pay);
      left -= pay;
      totalPaid += pay;
    }
    if (strategy !== "minimums") {
      for (const d of order) {
        if (left <= 0) break;
        const b = balance.get(d.id)!;
        if (b <= 0) continue;
        const pay = Math.min(b, left);
        balance.set(d.id, b - pay);
        left -= pay;
        totalPaid += pay;
      }
    }

    for (const d of owing) {
      if (balance.get(d.id)! <= 0 && !payoffOrder.some((p) => p.id === d.id)) {
        payoffOrder.push({ id: d.id, name: d.name, month });
      }
    }
    const after = [...balance.values()].reduce((a, b) => a + b, 0);
    if (after <= 0) {
      return { strategy, months: month, totalInterestCents: totalInterest, totalPaidCents: totalPaid, payoffOrder };
    }
    // Owing more than a year ago and nothing paid off since: it never ends.
    if (month >= 12 && after >= before && payoffOrder.length === 0) break;
  }
  return { strategy, months: null, totalInterestCents: totalInterest, totalPaidCents: totalPaid, payoffOrder };
}

/** "19.99" → 1999; null when it is not a rate from 0 to 100. */
export function parseAprInput(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps <= 10_000 ? bps : null;
}
