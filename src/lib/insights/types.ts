import type { RecurringCadence, TransactionType } from "@prisma/client";

/**
 * One transaction as the insight engine sees it. Plain data, no Prisma, so every detector is
 * a pure function of its input and `now`.
 *
 * `merchantName` / `pfc*` exist only for rows that came from a bank sync: Plaid's merchant and
 * category live on the staged row, not the Transaction, and the loader joins them back on.
 */
export type InsightTx = {
  id: string;
  type: TransactionType;
  /** Positive for money spent or received; a negative expense is a refund. */
  amountCents: number;
  date: Date;
  title: string | null;
  note: string | null;
  categoryId: string;
  categoryName: string;
  accountId: string | null;
  recurringTransactionId: string | null;
  /** Split parts win over the parent category wherever spend is attributed to categories. */
  splits: Array<{ categoryId: string; categoryName: string; amountCents: number }>;
  merchantName?: string | null;
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
};

export type InsightRecurringRule = {
  id: string;
  name: string;
  type: TransactionType;
  amountCents: number;
  cadence: RecurringCadence;
  enabled: boolean;
  categoryId: string;
};

export type InsightBudget = { categoryId: string; periodMonth: string };

export type InsightSection = "recurring" | "habit" | "saving" | "improvement";
export type InsightSeverity = "high" | "medium" | "low";

export type HabitKind = "TOBACCO_VAPE" | "CANNABIS" | "ALCOHOL" | "GAMBLING" | "GAMING_PURCHASES";

/** What the "Track it" form is prefilled with for a detected recurring charge. */
export type RecurringPrefill = {
  name: string;
  type: TransactionType;
  amountCents: number;
  cadence: RecurringCadence;
  accountId: string | null;
  categoryId: string;
  /** `YYYY-MM-DD`. */
  nextExpectedDate: string;
};

export type InsightAction =
  | { kind: "track-recurring"; prefill: RecurringPrefill }
  | { kind: "track-habit"; habit: HabitKind; merchants: string[] }
  | { kind: "link"; href: string; label: string };

export type Insight = {
  /** Stable across loads — the dismissal key. */
  key: string;
  section: InsightSection;
  severity: InsightSeverity;
  title: string;
  body: string;
  monthlyCents?: number;
  /** What this costs over a year: the spending the insight is about. */
  annualCents?: number;
  /**
   * What following the suggestion would realistically save in a year, with money another
   * insight already counts left out, so these add up to a total without counting twice.
   * Absent where there is nothing to add up: a one-off double charge, a habit.
   */
  savingCents?: number;
  /** Newest first. */
  evidenceTxIds: string[];
  action?: InsightAction;
};

export type InsightDismissalRow = {
  insightKey: string;
  snoozedUntil: Date | null;
  /** `insightSizeCents` when dismissed; null when it had none. */
  dismissedCents?: number | null;
};
