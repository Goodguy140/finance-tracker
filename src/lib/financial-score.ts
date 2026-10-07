import { shiftYm } from "@/lib/dashboard-period";
import { ymOf } from "@/lib/insights/util";
import type { ReportTx } from "@/lib/reports";

/**
 * The overall financial score shown on Insights and Reports: one 0–100 number built from a
 * few factors the app can actually measure, each with its own sub-score and, for the weakest,
 * one concrete thing to change.
 *
 * Everything is worked out over full calendar months before the current one, so a month
 * that has only just started cannot drag the score down. Months before the user's first
 * recorded income or expense are not counted either: someone who started tracking two months
 * ago is scored on two months, not on four empty ones.
 *
 * A factor with nothing to go on (no budgets set, no earlier months to compare) is left out
 * and the others are reweighted, rather than scored as zero.
 *
 * Account balances are not tracked, so nothing here can speak to savings on hand, debt or
 * an emergency fund.
 */

export const SCORE_LOOKBACK_MONTHS = 6;
/** Spending trend compares the latest half of the lookback with the half before it. */
const TREND_HALF = 3;
/** Budget adherence looks at this many of the latest full months. */
const BUDGET_MONTHS = 3;

export type FinancialScoreFactorId = "savings" | "bills" | "budgets" | "trend" | "consistency";

export type FinancialScoreFactor = {
  id: FinancialScoreFactorId;
  label: string;
  /** 0–100. */
  score: number;
  /** Share of the overall score, after factors with no data are dropped (sums to 1). */
  weight: number;
  /** What was measured, in a few words: "18% of income saved". */
  detail: string;
  /** One thing to do about it; null when the factor is already strong. */
  suggestion: string | null;
};

/** A factor that could not be scored, and why. */
export type FinancialScoreOmission = { label: string; reason: string };

export type FinancialScoreBand = "Strong" | "Good" | "Fair" | "Needs work" | "At risk";

export type FinancialScore =
  | {
      status: "scored";
      score: number;
      band: FinancialScoreBand;
      /** Full months the score is based on, oldest first. */
      months: string[];
      factors: FinancialScoreFactor[];
      /** Suggestions from the weakest factors, weakest first (at most three). */
      suggestions: string[];
      /** Factors left out for lack of data. */
      omitted: FinancialScoreOmission[];
    }
  | { status: "insufficient"; reason: string };

export type ScoreBudget = { categoryId: string; categoryName: string; periodMonth: string; limitCents: number };

export type ScoreRecurringRule = {
  name: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amountCents: number;
  cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
  enabled: boolean;
  endDate: Date | null;
};

export type FinancialScoreInput = {
  /** Expense and income rows; transfers are ignored if present. */
  txs: readonly ReportTx[];
  budgets: readonly ScoreBudget[];
  recurring: readonly ScoreRecurringRule[];
  todayYmd: string;
  /** Formats cents for suggestion text. */
  formatCents: (cents: number) => string;
};

const BASE_WEIGHTS: Record<FinancialScoreFactorId, number> = {
  savings: 35,
  bills: 20,
  budgets: 20,
  trend: 15,
  consistency: 10,
};

/** Occurrences per month for each cadence, to put every bill on a monthly footing. */
const PER_MONTH: Record<ScoreRecurringRule["cadence"], number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  YEARLY: 1 / 12,
  BIENNIAL: 1 / 24,
};

/** Straight-line interpolation through `points` (x ascending), clamped at both ends, to 0–100. */
function piecewise(x: number, points: ReadonlyArray<readonly [number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function scoreBand(score: number): FinancialScoreBand {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 35) return "Needs work";
  return "At risk";
}

/** Recurring bills as a monthly amount; disabled and ended rules do not count. */
export function monthlyRecurringCents(rules: readonly ScoreRecurringRule[], type: "EXPENSE" | "INCOME", todayYmd: string) {
  return rules
    .filter((r) => r.enabled && r.type === type && (!r.endDate || r.endDate.toISOString().slice(0, 10) >= todayYmd))
    .map((r) => ({ name: r.name, cents: Math.round(r.amountCents * PER_MONTH[r.cadence]) }))
    .sort((a, b) => b.cents - a.cents);
}

export function computeFinancialScore(input: FinancialScoreInput): FinancialScore {
  const { formatCents: fmt } = input;
  const currentYm = input.todayYmd.slice(0, 7);
  const txs = input.txs.filter((tx) => tx.type === "EXPENSE" || tx.type === "INCOME");

  const firstYm = txs.reduce<string | null>((min, tx) => {
    const ym = ymOf(tx.date);
    return min === null || ym < min ? ym : min;
  }, null);
  const months: string[] = [];
  for (let i = SCORE_LOOKBACK_MONTHS; i >= 1; i--) {
    const ym = shiftYm(currentYm, -i);
    if (firstYm !== null && ym >= firstYm) months.push(ym);
  }

  const byMonth = new Map(months.map((ym) => [ym, { income: 0, spending: 0 }]));
  const spendByMonthCategory = new Map<string, number>();
  const spendByCategoryName = new Map<string, { recent: number; earlier: number }>();
  const recentMonths = new Set(months.slice(-TREND_HALF));
  for (const tx of txs) {
    const ym = ymOf(tx.date);
    const bucket = byMonth.get(ym);
    if (!bucket) continue;
    if (tx.type === "INCOME") {
      bucket.income += tx.amountCents;
      continue;
    }
    bucket.spending += tx.amountCents;
    const parts = tx.splits.length ? tx.splits : [{ categoryId: tx.categoryId, categoryName: tx.categoryName, amountCents: tx.amountCents }];
    for (const part of parts) {
      const key = `${ym}|${part.categoryId}`;
      spendByMonthCategory.set(key, (spendByMonthCategory.get(key) ?? 0) + part.amountCents);
      const byName = spendByCategoryName.get(part.categoryName) ?? { recent: 0, earlier: 0 };
      if (recentMonths.has(ym)) byName.recent += part.amountCents;
      else byName.earlier += part.amountCents;
      spendByCategoryName.set(part.categoryName, byName);
    }
  }

  const flows = months.map((ym) => ({ ym, ...byMonth.get(ym)! }));
  const totalIncome = flows.reduce((s, m) => s + m.income, 0);
  const totalSpending = flows.reduce((s, m) => s + m.spending, 0);
  if (months.length === 0) {
    return { status: "insufficient", reason: "The score needs at least one full month of income and spending. Check back next month." };
  }
  if (totalIncome <= 0) {
    return {
      status: "insufficient",
      reason: "No income is recorded in the last few full months, so there is nothing to measure spending against.",
    };
  }
  const avgIncome = totalIncome / months.length;

  const factors: Array<Omit<FinancialScoreFactor, "weight">> = [];
  const left: FinancialScoreOmission[] = [];

  // Savings rate: what share of income was left after spending.
  const savingsRate = (totalIncome - totalSpending) / totalIncome;
  const savingsScore = piecewise(savingsRate, [
    [-0.1, 0],
    [0, 35],
    [0.1, 65],
    [0.2, 90],
    [0.3, 100],
  ]);
  const toTwenty = Math.ceil(Math.max(0, 0.2 * avgIncome - (avgIncome - totalSpending / months.length)));
  factors.push({
    id: "savings",
    label: "Savings rate",
    score: savingsScore,
    detail: savingsRate >= 0 ? `${pct(savingsRate)} of income saved` : `Spent ${pct(-savingsRate)} more than earned`,
    suggestion:
      savingsRate < 0.2
        ? `Spending about ${fmt(toTwenty)} less a month would bring your savings rate to 20%.`
        : null,
  });

  // Fixed bills: recurring expenses on a monthly footing, as a share of average income.
  const bills = monthlyRecurringCents(input.recurring, "EXPENSE", input.todayYmd);
  const billsCents = bills.reduce((s, b) => s + b.cents, 0);
  const billsShare = billsCents / avgIncome;
  const topBills = bills.slice(0, 3).map((b) => `${b.name} (${fmt(b.cents)}/mo)`);
  if (bills.length === 0) left.push({ label: "Fixed bills", reason: "no recurring bills set up" });
  else factors.push({
    id: "bills",
    label: "Fixed bills",
    score: piecewise(billsShare, [
      [0.35, 100],
      [0.5, 70],
      [0.65, 35],
      [0.8, 0],
    ]),
    detail: `${pct(billsShare)} of income goes to recurring bills`,
    suggestion:
      billsShare > 0.35
        ? `Recurring bills take ${pct(billsShare)} of income. ${topBills.length === 1 ? "The largest is" : "The largest are"} ${topBills.join(", ")}; trimming or renegotiating one frees room every month.`
        : null,
  });

  // Budget adherence: each budgeted category in each recent month, within its limit or not.
  const budgetMonths = months.slice(-BUDGET_MONTHS);
  let checks = 0;
  let credit = 0;
  const overByCategory = new Map<string, number>();
  for (const ym of budgetMonths) {
    const active = new Map<string, ScoreBudget>();
    for (const b of input.budgets) {
      if (b.periodMonth > ym || b.limitCents <= 0) continue;
      const existing = active.get(b.categoryId);
      if (!existing || b.periodMonth > existing.periodMonth) active.set(b.categoryId, b);
    }
    for (const budget of active.values()) {
      const spent = spendByMonthCategory.get(`${ym}|${budget.categoryId}`) ?? 0;
      checks++;
      if (spent <= budget.limitCents) credit += 1;
      else {
        if (spent <= budget.limitCents * 1.1) credit += 0.5;
        overByCategory.set(budget.categoryName, (overByCategory.get(budget.categoryName) ?? 0) + 1);
      }
    }
  }
  if (checks === 0) left.push({ label: "Budgets kept", reason: "no budgets set" });
  else {
    const worst = [...overByCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const within = checks - [...overByCategory.values()].reduce((s, n) => s + n, 0);
    factors.push({
      id: "budgets",
      label: "Budgets kept",
      score: (credit / checks) * 100,
      detail: `${within} of ${checks} monthly budget${checks === 1 ? "" : "s"} kept in the last ${budgetMonths.length} month${budgetMonths.length === 1 ? "" : "s"}`,
      suggestion: worst
        ? `${worst[0]} went over budget in ${worst[1]} of the last ${budgetMonths.length} month${budgetMonths.length === 1 ? "" : "s"}. Raise the limit to something you can keep, or move room from a category with spare.`
        : null,
    });
  }

  // Spending trend: the latest three months against the three before.
  const recentSpending = flows.slice(-TREND_HALF).reduce((s, m) => s + m.spending, 0);
  const earlierSpending = flows.slice(-TREND_HALF * 2, -TREND_HALF).reduce((s, m) => s + m.spending, 0);
  if (months.length < TREND_HALF * 2 || earlierSpending <= 0) {
    left.push({ label: "Spending trend", reason: `needs ${TREND_HALF * 2} full months of history` });
  } else {
    const change = (recentSpending - earlierSpending) / earlierSpending;
    const riser = [...spendByCategoryName.entries()]
      .map(([name, v]) => ({ name, delta: v.recent - v.earlier }))
      .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name))[0];
    factors.push({
      id: "trend",
      label: "Spending trend",
      score: piecewise(change, [
        [-0.05, 100],
        [0, 80],
        [0.1, 50],
        [0.25, 0],
      ]),
      detail:
        Math.abs(change) < 0.005
          ? "Spending is flat on the 3 months before"
          : `Spending ${change > 0 ? "up" : "down"} ${pct(Math.abs(change))} on the 3 months before`,
      suggestion:
        change > 0 && riser && riser.delta > 0
          ? `Spending rose ${pct(change)} over the last 3 months. The biggest rise is ${riser.name}, up ${fmt(Math.round(riser.delta / TREND_HALF))} a month.`
          : null,
    });
  }

  // Consistency: months that ended with money left over.
  const positive = flows.filter((m) => m.income - m.spending >= 0).length;
  const short = months.length - positive;
  factors.push({
    id: "consistency",
    label: "Months in the black",
    score: (positive / months.length) * 100,
    detail: `${positive} of ${months.length} month${months.length === 1 ? "" : "s"} ended with money left over`,
    suggestion:
      short > 0
        ? `You spent more than you earned in ${short} of the last ${months.length} month${months.length === 1 ? "" : "s"}. Setting money aside on payday for the irregular months evens this out.`
        : null,
  });

  const totalWeight = factors.reduce((s, f) => s + BASE_WEIGHTS[f.id], 0);
  const weighted = factors.map((f) => ({ ...f, score: Math.round(f.score), weight: BASE_WEIGHTS[f.id] / totalWeight }));
  const score = Math.round(factors.reduce((s, f) => s + f.score * BASE_WEIGHTS[f.id], 0) / totalWeight);
  const suggestions = [...weighted]
    .filter((f) => f.suggestion && f.score < 80)
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 3)
    .map((f) => f.suggestion as string);

  return { status: "scored", score, band: scoreBand(score), months, factors: weighted, suggestions, omitted: left };
}
