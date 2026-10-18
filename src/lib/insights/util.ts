import { dateFromYmd } from "@/lib/date-only";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { normalizeMerchant, titleCaseMerchant } from "@/lib/plaid/merchant-text";
import type { InsightTx } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Average days per month, for turning a window's spend into a monthly figure. */
export const DAYS_PER_MONTH = 365.25 / 12;

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * What the detectors take as "now": noon UTC on the user's own calendar date. Rows are stored
 * as UTC midnight of their day, so this makes "last month" the user's last month rather than
 * UTC's, which flips on the evening of the 31st anywhere west of Greenwich.
 */
export function insightsNow(timezone: string | null, clock: Date = new Date()): Date {
  return new Date(dateFromYmd(currentYmdInTimeZone(timezone, clock)).getTime() + DAY_MS / 2);
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** The text a transaction is known by: the bank's merchant name when there is one. */
export function displayTextFor(tx: Pick<InsightTx, "title" | "merchantName">): string {
  return (tx.merchantName || tx.title || "").trim();
}

/**
 * The key transactions from the same merchant share. Uses the bank-description cleanup so a
 * synced "SQ *BLUE BOTTLE #412" and a hand-typed "Blue Bottle" group together, and falls back
 * to the plain title key when that cleanup leaves nothing ("#123" alone, say).
 */
export function merchantKeyFor(tx: Pick<InsightTx, "title" | "merchantName">): string {
  const text = displayTextFor(tx);
  return normalizeMerchant(text) || normalizeExpenseTitleKey(text);
}

/**
 * A name to show. A short, clean original ("NSLC", "Tim Hortons") is kept as written —
 * title-casing would turn an acronym into "Nslc". Anything carrying store numbers or
 * reference codes gets the cleaned, title-cased form instead.
 */
export function merchantLabelFor(tx: Pick<InsightTx, "title" | "merchantName">): string {
  const text = displayTextFor(tx);
  if (text.length <= 32 && !/[#*\d]/.test(text)) return text;
  return titleCaseMerchant(text) || text;
}

/** Newest first, capped — evidence lists are for showing, not for counting. */
export function evidenceIds(txs: InsightTx[], limit = 12): string[] {
  return [...txs]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit)
    .map((tx) => tx.id);
}

export function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}

/** `YYYY-MM` of a date-only value (stored as UTC midnight). */
export function ymOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The `count` full calendar months before `now`'s month, oldest first. */
export function previousFullMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count; i >= 1; i--) {
    out.push(ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return out;
}

/** The date of the oldest row: how far back what the user has logged actually goes. */
export function historyStartOf(txs: ReadonlyArray<Pick<InsightTx, "date">>): Date | null {
  let start: Date | null = null;
  for (const tx of txs) if (!start || tx.date < start) start = tx.date;
  return start;
}

/**
 * Those of `months` the user's history covers in full. The month logging began in counts only
 * when it began on the 1st: a month half logged reads as a month half spent, which would make
 * every category look like it doubled the month after.
 */
export function observedMonths(months: readonly string[], historyStart: Date | null): string[] {
  if (!historyStart) return [];
  const firstYm = ymOf(historyStart);
  const firstIsWhole = historyStart.getUTCDate() === 1;
  return months.filter((ym) => ym > firstYm || (firstIsWhole && ym === firstYm));
}

/**
 * Days of a trailing `windowDays` window that the history covers: whole days since the first
 * row, so the figure does not shift with the time of day.
 */
export function observedDays(now: Date, historyStart: Date | null, windowDays: number): number {
  if (!historyStart) return 0;
  const days = Math.floor((now.getTime() - historyStart.getTime()) / DAY_MS);
  return Math.max(0, Math.min(windowDays, days));
}

/** A rate over fewer days than this is one or two purchases dressed up as a pattern. */
export const MIN_OBSERVED_DAYS = 30;

export type MoneyFormatter = (cents: number) => string;

/**
 * Whole units once an amount is large enough that cents are noise ("$1,700 a year"), exact
 * below that ("$12.99"). The currency is the user's, so a yen account never reads as dollars.
 */
export function moneyFormatter(currency = "CAD", locale = "en-CA"): MoneyFormatter {
  const exact = new Intl.NumberFormat(locale, { style: "currency", currency });
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  return (cents) => (Math.abs(cents) >= 10_000 ? whole : exact).format(cents / 100);
}
