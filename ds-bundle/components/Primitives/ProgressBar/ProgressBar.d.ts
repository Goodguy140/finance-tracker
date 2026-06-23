export type ProgressBarProps = {
  /** 0–100, capped at 100 for visual width */
  progressPct: number;
  /** Overrides automatic color selection */
  variant?: "ok" | "warn" | "critical";
};

export type BudgetProgressItemProps = {
  categoryName: string;
  spentCents: number;
  limitCents: number;
  progressPct: number;
};
