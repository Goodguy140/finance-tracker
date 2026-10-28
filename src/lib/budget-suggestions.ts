import { TransactionType } from "@prisma/client";
import { shiftYm } from "@/lib/dashboard-period";
import { categoryAmounts } from "@/lib/insights/facts";
import type { InsightTx } from "@/lib/insights/types";
import { median } from "@/lib/insights/util";

/** How far back a suggestion looks: the last 3 or 6 full months. */
export const SUGGESTION_WINDOWS = [3, 6] as const;
export type SuggestionWindow = (typeof SUGGESTION_WINDOWS)[number];

type SuggestionTx = Pick<InsightTx, "type" | "amountCents" | "date" | "categoryId" | "categoryName" | "splits">;

export type BudgetSuggestion = {
  categoryId: string;
  categoryName: string;
  /** What to set the budget to: the typical month, rounded up to a tidy amount. */
  suggestedCents: number;
  /** The median month, before rounding. */
  typicalCents: number;
  /** Spend per month of the window, oldest first, aligned with `BudgetSuggestionSet.months`. */
  monthlyCents: number[];
  /** Months well above the typical one (a one-off purchase), which the median passes over. */
  spikeMonths: string[];
  /** The budget in force this month, or null when the category has none. */
  currentLimitCents: number | null;
};

export type BudgetSuggestionSet = {
  window: SuggestionWindow;
  /** The full months looked at, oldest first; fewer than `window` for a newer user. */
  months: string[];
  rows: BudgetSuggestion[];
  /** Average income per month over the same months, to set the total against. */
  averageIncomeCents: number;
};

/** A month this far above the median counts as a spike. */
const SPIKE_FACTOR = 2;

/**
 * Rounded up to an amount a person would type: to $5 up to $100, $10 up to $1,000, then $25.
 * Up rather than to nearest, so a typical month fits inside the budget.
 */
export function roundBudgetCents(cents: number): number {
  if (cents <= 0) return 0;
  const step = cents <= 100_00 ? 5_00 : cents <= 1_000_00 ? 10_00 : 25_00;
  return Math.ceil(cents / step) * step;
}

/**
 * The full months a suggestion looks at: up to `window` months before `currentYm` (the month
 * under way is left out, being only part spent), but none before the user's first transaction,
 * so a month before they started tracking does not pull the typical month down to zero.
 */
export function suggestionMonths(currentYm: string, window: number, firstActivityYm: string | null): string[] {
  if (!firstActivityYm) return [];
  const months: string[] = [];
  for (let i = window; i >= 1; i--) {
    const ym = shiftYm(currentYm, -i);
    if (ym >= firstActivityYm) months.push(ym);
  }
  return months;
}

/**
 * A monthly budget for each expense category from what was spent in `months`: the median
 * month, which a single large month does not move, rounded up. A category spent on in fewer
 * than half the months gets none, since its median is nothing; the same goes for one whose
 * refunds outweigh its spending. Split transactions count toward their parts' categories.
 */
export function suggestBudgets(input: {
  window: SuggestionWindow;
  months: readonly string[];
  txs: readonly SuggestionTx[];
  /** Expense categories, the only ones a budget can be set on. */
  categories: ReadonlyArray<{ id: string; name: string }>;
  currentLimits: ReadonlyMap<string, number>;
}): BudgetSuggestionSet {
  const { window, months, txs, categories, currentLimits } = input;
  const index = new Map(months.map((ym, i) => [ym, i]));
  const spend = new Map<string, number[]>();
  let incomeCents = 0;
  for (const tx of txs) {
    const i = index.get(tx.date.toISOString().slice(0, 7));
    if (i === undefined) continue;
    if (tx.type === TransactionType.INCOME) {
      incomeCents += tx.amountCents;
      continue;
    }
    if (tx.type !== TransactionType.EXPENSE) continue;
    for (const part of categoryAmounts(tx as InsightTx)) {
      let row = spend.get(part.categoryId);
      if (!row) spend.set(part.categoryId, (row = months.map(() => 0)));
      row[i] += part.amountCents;
    }
  }

  const rows: BudgetSuggestion[] = [];
  for (const category of categories) {
    const monthlyCents = spend.get(category.id);
    if (!monthlyCents) continue;
    const typicalCents = median(monthlyCents);
    const suggestedCents = roundBudgetCents(typicalCents);
    if (suggestedCents <= 0) continue;
    rows.push({
      categoryId: category.id,
      categoryName: category.name,
      suggestedCents,
      typicalCents,
      monthlyCents,
      spikeMonths: months.filter((_, i) => monthlyCents[i] > typicalCents * SPIKE_FACTOR),
      currentLimitCents: currentLimits.get(category.id) ?? null,
    });
  }
  rows.sort((a, b) => b.suggestedCents - a.suggestedCents || a.categoryName.localeCompare(b.categoryName));

  return {
    window,
    months: [...months],
    rows,
    averageIncomeCents: months.length ? Math.round(incomeCents / months.length) : 0,
  };
}
