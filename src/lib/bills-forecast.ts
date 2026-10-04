import { advanceRecurringDate, advanceRecurringDateOnOrAfter, type RecurringForecastRule } from "./recurring-transactions";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

export const BILLS_FORECAST_DAY_OPTIONS = [30, 60, 90] as const;
export type BillsForecastDays = (typeof BILLS_FORECAST_DAY_OPTIONS)[number];
export const DEFAULT_BILLS_FORECAST_DAYS: BillsForecastDays = 30;

type ForecastableRule = Pick<RecurringForecastRule, "type" | "amountCents" | "cadence" | "nextExpectedDate" | "endDate" | "enabled">;

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
 * days after today, earliest first.
 *
 * A rule starts from its outstanding occurrence, carried forward to the current month when
 * it is overdue from an earlier one — the same rule the Recurring card follows, where posting
 * this month's occurrence passes over the missed ones. So the latest unposted occurrence
 * before today, if it falls this month, is listed (as overdue) and counted; the missed ones
 * before it are not counted again and surface only as its "unposted since" date.
 */
export function forecastRecurringOccurrences<T extends ForecastableRule>(
  rules: readonly T[],
  options: { todayYmd: string; currentYm: string; days: number },
): BillsForecast<T> {
  const monthStart = dateFromYmd(`${options.currentYm}-01`);
  const windowEnd = dateFromYmd(options.todayYmd);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + options.days);
  const windowEndYmd = ymdFromDateUtc(windowEnd);

  const occurrences: BillsForecastOccurrence<T>[] = [];
  for (const rule of rules) {
    // Only bills and income: a transfer rule moves money between the user's own accounts.
    if (!rule.enabled || (rule.type !== "EXPENSE" && rule.type !== "INCOME")) continue;
    const endYmd = rule.endDate ? ymdFromDateUtc(rule.endDate) : null;
    const nextYmd = ymdFromDateUtc(rule.nextExpectedDate);
    let date = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, monthStart);
    // Several missed occurrences this month (a weekly bill) collapse into the latest one:
    // posting it passes over the rest, so listing each would count money that is not owed.
    for (let next = advanceRecurringDate(date, rule.cadence); ; next = advanceRecurringDate(date, rule.cadence)) {
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
      date = advanceRecurringDate(date, rule.cadence);
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
 * first listed day through each one. Occurrences must be sorted, as the forecast returns them.
 */
export function groupForecastByDay<T extends Pick<RecurringForecastRule, "type" | "amountCents">>(
  occurrences: readonly BillsForecastOccurrence<T>[],
): Array<{ dateYmd: string; occurrences: BillsForecastOccurrence<T>[]; runningNetCents: number }> {
  const days: Array<{ dateYmd: string; occurrences: BillsForecastOccurrence<T>[]; runningNetCents: number }> = [];
  let running = 0;
  for (const occurrence of occurrences) {
    const dateYmd = ymdFromDateUtc(occurrence.date);
    running += occurrence.rule.type === "INCOME" ? occurrence.rule.amountCents : -occurrence.rule.amountCents;
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
