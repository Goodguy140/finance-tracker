import {
  advanceRecurringDate,
  advanceRecurringDateOnOrAfter,
  recurringAnchor,
  type RecurringForecastRule,
} from "./recurring-transactions";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

export const BILLS_FORECAST_DAY_OPTIONS = [30, 60, 90] as const;
export type BillsForecastDays = (typeof BILLS_FORECAST_DAY_OPTIONS)[number];
export const DEFAULT_BILLS_FORECAST_DAYS: BillsForecastDays = 30;

type ForecastableRule = Pick<RecurringForecastRule, "type" | "amountCents" | "cadence" | "nextExpectedDate" | "anchorDay" | "secondAnchorDay" | "beforeWeekend" | "endDate" | "enabled">;

export type BillsForecastOccurrence<T> = {
  rule: T;
  date: Date;
  /** Before today but still unposted: this month's occurrence, waiting on the user. */
  overdue: boolean;
  /**
   * Set on a rule's first occurrence when it is carried forward past a missed one from an
   * earlier month — the date it has been unposted since, as the Recurring card shows it.
   */
  missedSince: Date | null;
};

export type BillsForecast<T> = {
  occurrences: BillsForecastOccurrence<T>[];
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

/**
 * The occurrences of every enabled expense and income rule from the start of the current month through `days`
 * days after today, earliest first. Transfer rules too with `includeTransfers`, for a projection
 * that moves money between accounts; they never count toward the income and bill totals.
 *
 * A rule starts from its outstanding occurrence, carried forward to the current month when
 * it is overdue from an earlier one — the same rule the Recurring card follows, where posting
 * this month's occurrence passes over the missed ones. So the latest unposted occurrence
 * before today, if it falls this month, is listed (as overdue) and counted; the missed ones
 * before it are not counted again and surface only as its "unposted since" date.
 */
export function forecastRecurringOccurrences<T extends ForecastableRule>(
  rules: readonly T[],
  options: { todayYmd: string; currentYm: string; days: number; includeTransfers?: boolean },
): BillsForecast<T> {
  const monthStart = dateFromYmd(`${options.currentYm}-01`);
  const windowEnd = dateFromYmd(options.todayYmd);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + options.days);
  const windowEndYmd = ymdFromDateUtc(windowEnd);

  const occurrences: BillsForecastOccurrence<T>[] = [];
  for (const rule of rules) {
    // Only bills and income, unless asked: a transfer rule moves money between the user's own accounts.
    const listed = rule.type === "EXPENSE" || rule.type === "INCOME" || (options.includeTransfers && rule.type === "TRANSFER");
    if (!rule.enabled || !listed) continue;
    const endYmd = rule.endDate ? ymdFromDateUtc(rule.endDate) : null;
    const nextYmd = ymdFromDateUtc(rule.nextExpectedDate);
    const anchor = recurringAnchor(rule);
    let date = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, monthStart, anchor);
    // Several missed occurrences this month (a weekly bill) collapse into the latest one:
    // posting it passes over the rest, so listing each would count money that is not owed.
    for (
      let next = advanceRecurringDate(date, rule.cadence, anchor);
      ;
      next = advanceRecurringDate(date, rule.cadence, anchor)
    ) {
      const candidateYmd = ymdFromDateUtc(next);
      if (candidateYmd >= options.todayYmd || (endYmd && candidateYmd > endYmd)) break;
      date = next;
    }
    let missedSince = ymdFromDateUtc(date) > nextYmd ? rule.nextExpectedDate : null;
    let guard = 0;
    while (guard < 1040) {
      const ymd = ymdFromDateUtc(date);
      if (ymd > windowEndYmd || (endYmd && ymd > endYmd)) break;
      occurrences.push({ rule, date, overdue: ymd < options.todayYmd, missedSince });
      missedSince = null;
      date = advanceRecurringDate(date, rule.cadence, anchor);
      guard++;
    }
  }

  occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());

  let incomeCents = 0;
  let expenseCents = 0;
  for (const { rule } of occurrences) {
    if (rule.type === "INCOME") incomeCents += rule.amountCents;
    else if (rule.type === "EXPENSE") expenseCents += rule.amountCents;
  }
  return { occurrences, incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

/**
 * Groups a forecast's occurrences by date, with the running net (income less bills) from the
 * first listed day through each one. A transfer between the user's own accounts (a card payment
 * among them) is listed on its day but moves no money in or out, so the net passes over it.
 * Occurrences must be sorted, as the forecast returns them.
 */
export function groupForecastByDay<T extends Pick<RecurringForecastRule, "type" | "amountCents">>(
  occurrences: readonly BillsForecastOccurrence<T>[],
): Array<{ dateYmd: string; occurrences: BillsForecastOccurrence<T>[]; runningNetCents: number }> {
  const days: Array<{ dateYmd: string; occurrences: BillsForecastOccurrence<T>[]; runningNetCents: number }> = [];
  let running = 0;
  for (const occurrence of occurrences) {
    const dateYmd = ymdFromDateUtc(occurrence.date);
    if (occurrence.rule.type === "INCOME") running += occurrence.rule.amountCents;
    else if (occurrence.rule.type === "EXPENSE") running -= occurrence.rule.amountCents;
    const last = days.at(-1);
    if (last?.dateYmd === dateYmd) {
      last.occurrences.push(occurrence);
      last.runningNetCents = running;
    } else {
      days.push({ dateYmd, occurrences: [occurrence], runningNetCents: running });
    }
  }
  return days;
}
