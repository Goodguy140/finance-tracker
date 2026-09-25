/**
 * How much text the dashboard keeps readable before it merges a column away, as whole
 * percentages stored on the user row. The defaults are the values the rule was tuned with:
 * at 95% a card whose every date is cut off (about a tenth of its text) loses a column, while
 * one overlong title does not.
 */
export type DashboardReadability = {
  /** Share of each card's text that must be fully visible. */
  textVisiblePct: number;
  /** Share of each budget name that must be visible, judged name by name. */
  budgetNameVisiblePct: number;
};

export const DEFAULT_DASHBOARD_READABILITY: DashboardReadability = {
  textVisiblePct: 95,
  budgetNameVisiblePct: 90,
};

/**
 * Below half of a card's text, "readable" stops meaning anything. A budget name can go much
 * lower: it sits beside its amount and progress bar, so its first few letters can be enough
 * to tell the rows apart. 100 is allowed for both and means any cut-off text costs a column.
 */
export const MIN_TEXT_VISIBLE_PCT = 50;
export const MIN_BUDGET_NAME_VISIBLE_PCT = 10;
export const MAX_VISIBLE_PCT = 100;

/** A whole percentage from `min` to `MAX_VISIBLE_PCT`, or an error naming the field. */
export function parseVisiblePct(raw: string | null | undefined, label: string, min: number): number {
  const text = (raw ?? "").trim();
  // Digits only: `Number` would also take "1e2" or "0x5f".
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(value >= min && value <= MAX_VISIBLE_PCT)) {
    throw new Error(`${label} must be a whole number from ${min} to ${MAX_VISIBLE_PCT}.`);
  }
  return value;
}
