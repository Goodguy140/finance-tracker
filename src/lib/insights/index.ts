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
  return (
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (b.annualCents ?? 0) - (a.annualCents ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

/** A dismissal hides its key for good, or until a snooze runs out. */
export function isDismissalActive(row: InsightDismissalRow, now: Date): boolean {
  return row.snoozedUntil === null || row.snoozedUntil > now;
}

export function buildInsights(input: BuildInsightsInput): BuiltInsights {
  const { txs, rules, budgets, now, fmt, toSavingsByMonth } = input;
  const candidates = detectRecurringCandidates(txs, rules, now);
  const all = [
    ...recurringCandidateInsights(candidates, fmt),
    // Turned off means not computed at all, not merely hidden.
    ...(input.habitsEnabled ? habitInsights(summarizeHabitSpending(txs, now), fmt) : []),
    ...detectSavingsOpportunities({ txs, rules, candidates, now, fmt }),
    ...suggestImprovements({ txs, budgets, now, fmt, toSavingsByMonth }),
  ].sort(compareInsights);

  const activeDismissals = new Map(
    input.dismissals.filter((row) => isDismissalActive(row, input.clock ?? now)).map((row) => [row.insightKey, row]),
  );
  const visible: Insight[] = [];
  const dismissed: BuiltInsights["dismissed"] = [];
  for (const insight of all) {
    const row = activeDismissals.get(insight.key);
    if (row) dismissed.push({ ...insight, snoozedUntil: row.snoozedUntil });
    else visible.push(insight);
  }
  return { visible, dismissed };
}
