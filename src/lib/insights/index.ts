import { habitInsights, summarizeHabitSpending } from "./habits";
import { suggestImprovements } from "./improvements";
import { detectRecurringCandidates, recurringCandidateInsights } from "./recurring-detection";
import { detectSavingsOpportunities } from "./savings";
import type {
  Insight,
  InsightBudget,
  InsightDismissalRow,
  InsightRecurringRule,
  InsightSection,
  InsightSeverity,
  InsightTx,
} from "./types";
import type { MoneyFormatter } from "./util";

export type BuildInsightsInput = {
  txs: InsightTx[];
  rules: InsightRecurringRule[];
  budgets: InsightBudget[];
  now: Date;
  fmt: MoneyFormatter;
  habitsEnabled: boolean;
  dismissals: InsightDismissalRow[];
  /** See `ImprovementsInput.toSavingsByMonth`. */
  toSavingsByMonth?: ReadonlyMap<string, number> | null;
  /**
   * The financial score's suggestions (`scoreInsights`), listed with the rest. When given, the
   * engine's own savings-rate suggestion is left out: the score's savings and months-in-the-
   * black factors say the same, measured the same way.
   */
  scoreInsights?: Insight[] | null;
  /**
   * The actual time, for whether a snooze has run out. `now` is the user's local date at noon
   * UTC, so the calendar months the detectors work in are the user's own.
   */
  clock?: Date;
};

export type BuiltInsights = {
  /** What to show, in display order. */
  visible: Insight[];
  /** Dismissed or snoozed, still applicable — the "Dismissed" list, so it can be restored. */
  dismissed: Array<Insight & { snoozedUntil: Date | null }>;
};

export const SECTION_ORDER: InsightSection[] = ["recurring", "habit", "saving", "improvement"];
const SEVERITY_ORDER: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };

export function compareInsights(a: Insight, b: Insight): number {
  return SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || compareBySeverity(a, b);
}

/** Most pressing first, then the biggest, then a stable order: the dashboard card's ranking. */
export function compareBySeverity(a: Insight, b: Insight): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (b.annualCents ?? 0) - (a.annualCents ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

/** How big an insight is, in cents a year, for telling when a dismissed one has grown. */
export function insightSizeCents(insight: Pick<Insight, "annualCents" | "monthlyCents">): number | null {
  if (insight.annualCents !== undefined) return insight.annualCents;
  if (insight.monthlyCents !== undefined) return insight.monthlyCents * 12;
  return null;
}

/** Half as big again as when it was dismissed: no longer what the user said no to. */
export const DISMISSAL_REGROWTH = 1.5;

/**
 * A dismissal hides its key for good, or until a snooze runs out — unless the insight has
 * since grown well past the size it was dismissed at.
 */
export function isDismissalActive(row: InsightDismissalRow, now: Date, insight?: Insight): boolean {
  if (row.snoozedUntil !== null && row.snoozedUntil <= now) return false;
  const size = insight ? insightSizeCents(insight) : null;
  if (row.dismissedCents != null && row.dismissedCents > 0 && size !== null && size >= row.dismissedCents * DISMISSAL_REGROWTH) {
    return false;
  }
  return true;
}

export function buildInsights(input: BuildInsightsInput): BuiltInsights {
  const { rules, budgets, now, fmt, toSavingsByMonth } = input;
  // An entry dated ahead (a bill logged before it is due) has not happened yet.
  const txs = input.txs.filter((tx) => tx.date <= now);
  const candidates = detectRecurringCandidates(txs, rules, now);
  const all = [
    ...recurringCandidateInsights(candidates, fmt),
    // Turned off means not computed at all, not merely hidden.
    ...(input.habitsEnabled ? habitInsights(summarizeHabitSpending(txs, now), fmt) : []),
    ...detectSavingsOpportunities({ txs, rules, candidates, now, fmt }),
    ...suggestImprovements({ txs, budgets, now, fmt, toSavingsByMonth, withSavingsRate: !input.scoreInsights }),
    ...(input.scoreInsights ?? []),
  ].sort(compareInsights);

  const dismissals = new Map(input.dismissals.map((row) => [row.insightKey, row]));
  const visible: Insight[] = [];
  const dismissed: BuiltInsights["dismissed"] = [];
  for (const insight of all) {
    const found = dismissals.get(insight.key);
    const row = found && isDismissalActive(found, input.clock ?? now, insight) ? found : null;
    if (row) dismissed.push({ ...insight, snoozedUntil: row.snoozedUntil });
    else visible.push(insight);
  }
  return { visible, dismissed };
}
