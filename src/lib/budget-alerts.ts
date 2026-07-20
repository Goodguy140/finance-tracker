import { endExclusiveOfMonthYm, shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { formatCurrency } from "@/lib/money";

export type BudgetProgressInput = {
  categoryId: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
};

export type BudgetWarningSeverity = "warning" | "critical";

export type BudgetWarning = {
  categoryId: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
  percentUsed: number;
  /** limit − spent: positive when under budget, negative when over. */
  remainingCents: number;
  daysLeft: number;
  severity: BudgetWarningSeverity;
  message: string;
};

export type BudgetTrendAlert = {
  categoryId: string;
  categoryName: string;
  paceRatio: number;
  projectedOverCents: number;
  message: string;
};

export type PriorMonthSpendInput = {
  categoryId: string;
  spentCents: number;
  limitCents: number;
};

/** Inclusive day count in a calendar month (`YYYY-MM`). */
export function daysInMonthYm(ym: string): number {
  const start = startOfMonthYm(ym);
  const end = endExclusiveOfMonthYm(ym);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/** 1-based day index within `ym` for `reference` (clamped to month bounds). */
export function dayOfMonthInYm(reference: Date, ym: string): number {
  const start = startOfMonthYm(ym);
  const end = endExclusiveOfMonthYm(ym);
  const refMs = reference.getTime();
  if (refMs < start.getTime()) return 1;
  if (refMs >= end.getTime()) return daysInMonthYm(ym);
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((refMs - start.getTime()) / dayMs) + 1;
}

/** Whole days remaining in `ym` after `reference` (0 on last day of month). */
export function daysLeftInMonthYm(reference: Date, ym: string): number {
  const total = daysInMonthYm(ym);
  const elapsed = dayOfMonthInYm(reference, ym);
  return Math.max(0, total - elapsed);
}

export function percentUsed(spentCents: number, limitCents: number): number {
  if (limitCents <= 0) return 0;
  return Math.round((spentCents / limitCents) * 100);
}

export function formatBudgetWarningMessage(
  categoryName: string,
  pct: number,
  daysLeft: number,
  remainingCents?: number,
): string {
  const dayLabel = daysLeft === 1 ? "day" : "days";
  if (remainingCents === undefined) {
    return `${categoryName} is ${pct}% used with ${daysLeft} ${dayLabel} left.`;
  }
  return `${categoryName} is ${pct}% used — ${formatCurrency(remainingCents)} left, ${daysLeft} ${dayLabel} left.`;
}

export function formatBudgetOverBudgetMessage(categoryName: string, overCents: number): string {
  return `${categoryName} is over budget by ${formatCurrency(overCents)}.`;
}

const SEVERITY_RANK: Record<BudgetWarningSeverity, number> = { critical: 1, warning: 0 };

export function computeBudgetWarnings(
  rows: BudgetProgressInput[],
  options: {
    ym: string;
    reference?: Date;
    warningThresholdPct?: number;
  },
): BudgetWarning[] {
  const reference = options.reference ?? new Date();
  const warningThreshold = options.warningThresholdPct ?? 80;
  const daysLeft = daysLeftInMonthYm(reference, options.ym);

  return rows
    .filter((row) => row.limitCents > 0)
    .map((row) => {
      const pct = percentUsed(row.spentCents, row.limitCents);
      // Classify on cents, not the rounded percent: being exactly at the limit
      // (e.g. right after a rebalance) is on-budget, not over.
      const severity: BudgetWarningSeverity | null =
        row.spentCents > row.limitCents
          ? "critical"
          : row.spentCents < row.limitCents && pct >= warningThreshold
            ? "warning"
            : null;
      if (!severity) return null;
      const remainingCents = row.limitCents - row.spentCents;
      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        spentCents: row.spentCents,
        limitCents: row.limitCents,
        percentUsed: pct,
        remainingCents,
        daysLeft,
        severity,
        message:
          severity === "critical"
            ? formatBudgetOverBudgetMessage(row.categoryName, -remainingCents)
            : formatBudgetWarningMessage(row.categoryName, pct, daysLeft, remainingCents),
      };
    })
    .filter((row): row is BudgetWarning => row !== null)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.percentUsed - a.percentUsed);
}

/**
 * Categories spending faster than linear pace through the month (projected to exceed limit).
 * `paceRatio` = (spent/limit) / (elapsedDays/totalDays); values above 1 mean over pace.
 */
export function computeOverBudgetTrends(
  rows: BudgetProgressInput[],
  options: {
    ym: string;
    reference?: Date;
    paceThreshold?: number;
    minElapsedDays?: number;
  },
): BudgetTrendAlert[] {
  const reference = options.reference ?? new Date();
  const paceThreshold = options.paceThreshold ?? 1.05;
  const minElapsedDays = options.minElapsedDays ?? 3;
  const totalDays = daysInMonthYm(options.ym);
  const elapsed = dayOfMonthInYm(reference, options.ym);
  // Too early in the month for a projection to mean anything (one purchase on
  // day 1 would look like a runaway pace).
  if (elapsed < minElapsedDays || totalDays <= 0) return [];

  const expectedFraction = elapsed / totalDays;

  return rows
    // Skip categories already over budget: the critical warning is the headline,
    // and "on track to exceed" is contradictory once it has already exceeded.
    .filter((row) => row.limitCents > 0 && row.spentCents > 0 && row.spentCents < row.limitCents)
    .map((row) => {
      const spentFraction = row.spentCents / row.limitCents;
      const paceRatio = expectedFraction > 0 ? spentFraction / expectedFraction : 0;
      if (paceRatio < paceThreshold) return null;

      const projectedSpendCents = Math.round((row.spentCents / elapsed) * totalDays);
      const projectedOverCents = Math.max(0, projectedSpendCents - row.limitCents);
      const pctOverPace = Math.round((paceRatio - 1) * 100);

      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        paceRatio,
        projectedOverCents,
        message:
          projectedOverCents > 0
            ? `${row.categoryName} is on track to exceed its budget by ${formatCurrency(projectedOverCents)} (${pctOverPace}% ahead of pace).`
            : `${row.categoryName} is spending ${pctOverPace}% faster than the month-to-date pace.`,
      };
    })
    .filter((row): row is BudgetTrendAlert => row !== null)
    .sort((a, b) => b.paceRatio - a.paceRatio);
}

/** Month-over-month: daily spend rate vs prior month's average daily rate. */
export function computeMonthOverMonthTrends(
  rows: BudgetProgressInput[],
  priorByCategory: Map<string, PriorMonthSpendInput>,
  options: {
    ym: string;
    reference?: Date;
    rateThreshold?: number;
    minElapsedDays?: number;
  },
): BudgetTrendAlert[] {
  const reference = options.reference ?? new Date();
  const rateThreshold = options.rateThreshold ?? 1.1;
  const minElapsedDays = options.minElapsedDays ?? 3;
  const priorYm = shiftYm(options.ym, -1);
  const priorDays = daysInMonthYm(priorYm);
  const elapsed = dayOfMonthInYm(reference, options.ym);
  // Daily-rate comparisons are too jumpy in the first days of the month.
  if (elapsed < minElapsedDays) return [];

  return rows
    // Already-over-budget categories are covered by the critical warning.
    .filter((row) => row.limitCents > 0 && row.spentCents > 0 && row.spentCents < row.limitCents)
    .map((row) => {
      const prior = priorByCategory.get(row.categoryId);
      if (!prior || prior.spentCents <= 0) return null;

      const currentDaily = row.spentCents / elapsed;
      const priorDaily = prior.spentCents / priorDays;
      if (priorDaily <= 0) return null;

      const rateRatio = currentDaily / priorDaily;
      if (rateRatio < rateThreshold) return null;

      const pctFaster = Math.round((rateRatio - 1) * 100);
      const priorPct = percentUsed(prior.spentCents, prior.limitCents || prior.spentCents);

      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        paceRatio: rateRatio,
        projectedOverCents: 0,
        message: `${row.categoryName} is spending ${pctFaster}% faster per day than last month (prior month ended at ${priorPct}% of budget).`,
      };
    })
    .filter((row): row is BudgetTrendAlert => row !== null)
    .sort((a, b) => b.paceRatio - a.paceRatio);
}
