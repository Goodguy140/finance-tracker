import { dateFromYmd, formatDateOnlyUtc } from "@/lib/date-only";
import { currentYmdInTimeZone } from "@/lib/period-month";

/**
 * How far back a sync reaches, and how to say so without overpromising.
 *
 * Three facts drive everything here:
 *
 *  1. `days_requested` is set ONCE, at /link/token/create. It tells Plaid how much history
 *     to pull from the institution when the item is created. It is not a filter that can
 *     be re-applied later.
 *  2. /transactions/sync takes no date parameters at all. It returns everything from the
 *     cursor forward until `has_more` is false. You cannot ask it for "the last 90 days".
 *  3. Therefore the window is enforced at ingest: rows older than the cutoff are dropped
 *     as they arrive. They still advance the cursor — they are simply never staged.
 *
 * And one fact that governs the wording: an institution may return far less than was
 * requested, and frequently does. The UI states the exact date the user was promised and,
 * once the first sync finishes, says plainly when the bank gave less.
 */

export const HISTORY_WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
  { days: 730, label: "24 months" },
] as const;

export type HistoryWindowDays = (typeof HISTORY_WINDOWS)[number]["days"];

const VALID_DAYS: ReadonlySet<number> = new Set(HISTORY_WINDOWS.map((w) => w.days));

export function isHistoryWindowDays(value: number): value is HistoryWindowDays {
  return VALID_DAYS.has(value);
}

/** Parses the form value; anything unrecognised falls back to the conservative 90 days. */
export function parseHistoryWindowDays(raw: string | null | undefined): HistoryWindowDays {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return isHistoryWindowDays(n) ? n : 90;
}

export function historyWindowLabel(days: number): string {
  return HISTORY_WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`;
}

/**
 * The oldest date a sync will accept, as UTC midnight.
 *
 * "Today" is resolved in the user's own timezone before counting back, so someone in
 * Toronto asking for 30 days at 21:00 on the 18th gets the 18th as day zero rather than
 * the 19th that UTC would already be showing. The result is UTC midnight because that is
 * how every calendar date in this app is stored (see `date-only.ts`).
 *
 * Written once at link time and never recomputed — the UI reads the stored value rather
 * than deriving it, so what the user was promised cannot drift as days pass.
 */
export function resolveHistoryCutoff(
  days: number,
  timezone: string | null | undefined,
  reference = new Date(),
): Date {
  const todayLocal = dateFromYmd(currentYmdInTimeZone(timezone, reference));
  const cutoff = new Date(todayLocal);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

/** "Plaid will fetch transactions back to Wed, 18 Sep 2024. Your bank may return less." */
export function describeHistoryWindow(days: number, cutoff: Date, locale?: string): string {
  return `Plaid will fetch transactions back to ${formatDateOnlyUtc(cutoff, locale)}. Your bank may return less.`;
}

/** "History: 24 months (back to Wed, 18 Sep 2024)" — the standing line in Settings. */
export function describeHistorySetting(days: number, cutoff: Date, locale?: string): string {
  return `History: ${historyWindowLabel(days)} (back to ${formatDateOnlyUtc(cutoff, locale)})`;
}

/**
 * A bank with no activity in the first days of the window has not short-changed anyone, so
 * a small gap is not reported. Seven days is generous enough to cover a quiet week.
 */
export const DEFAULT_SHORTFALL_GRACE_DAYS = 7;

export type ShortfallInput = {
  institutionName: string | null;
  requestedDays: number;
  requestedCutoff: Date;
  /** Oldest date the institution actually returned; null before the first sync completes. */
  earliestObserved: Date | null;
  graceDays?: number;
  locale?: string;
};

/**
 * Says plainly when the bank returned less history than was asked for, or null when it
 * did not. Null is the common case and must stay silent — a warning that fires on every
 * healthy item trains people to ignore it.
 */
export function describeShortfall(input: ShortfallInput): string | null {
  const { earliestObserved, requestedCutoff } = input;
  if (!earliestObserved) return null;

  const graceDays = input.graceDays ?? DEFAULT_SHORTFALL_GRACE_DAYS;
  const graceLimit = new Date(requestedCutoff);
  graceLimit.setUTCDate(graceLimit.getUTCDate() + graceDays);
  if (earliestObserved.getTime() <= graceLimit.getTime()) return null;

  const bank = input.institutionName ?? "Your bank";
  return (
    `You asked for ${historyWindowLabel(input.requestedDays)}, back to ` +
    `${formatDateOnlyUtc(requestedCutoff, input.locale)}. ${bank} returned transactions from ` +
    `${formatDateOnlyUtc(earliestObserved, input.locale)} onward — that is everything it holds ` +
    `for this account. Older transactions will not appear here; import them from a CSV if you need them.`
  );
}

/** True when a transaction is older than the window and should never be staged. */
export function isBeforeCutoff(date: Date, cutoff: Date): boolean {
  return date.getTime() < cutoff.getTime();
}
