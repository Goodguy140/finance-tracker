import type { RecurringCadence, TransactionType } from "@prisma/client";
import { shiftYm } from "./dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

/** Add calendar months in UTC, clamping the day (e.g. Jan 31 + 1 month -> Feb 28). */
export function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = m + months;
  const anchor = new Date(Date.UTC(y, targetMonth, 1));
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  const dayClamped = Math.min(day, lastDay);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), dayClamped));
}

export function advanceRecurringDate(date: Date, cadence: RecurringCadence): Date {
  const next = new Date(date.getTime());
  switch (cadence) {
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "BIWEEKLY":
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case "MONTHLY":
      return addUtcMonths(date, 1);
    case "QUARTERLY":
      return addUtcMonths(date, 3);
    case "YEARLY":
      return addUtcMonths(date, 12);
    case "BIENNIAL":
      return addUtcMonths(date, 24);
  }
}

export function advanceRecurringDateOnOrAfter(
  nextExpectedDate: Date,
  cadence: RecurringCadence,
  onOrAfter: Date,
): Date {
  let date = new Date(nextExpectedDate.getTime());
  const targetYmd = ymdFromDateUtc(onOrAfter);
  let guard = 0;
  while (ymdFromDateUtc(date) < targetYmd && guard < 1040) {
    date = advanceRecurringDate(date, cadence);
    guard++;
  }
  return date;
}

export type RecurringDateStatus = "overdue" | "due" | "upcoming";

export function getRecurringDateStatus(nextExpectedDate: Date, today: Date = new Date()): RecurringDateStatus {
  const expectedYmd = ymdFromDateUtc(nextExpectedDate);
  const todayYmd = ymdFromDateUtc(today);
  if (expectedYmd < todayYmd) return "overdue";
  if (expectedYmd === todayYmd) return "due";
  return "upcoming";
}

export type RecurringForecastRule = {
  type: TransactionType;
  amountCents: number;
  cadence: RecurringCadence;
  nextExpectedDate: Date;
  endDate: Date | null;
  enabled: boolean;
};

/**
 * The occurrence of a rule to show for the viewed month `ym`, given the current month
 * `currentYm`, or null when the rule has none there. A rule's outstanding occurrence is its
 * `nextExpectedDate`, which places it in its own month. From the current month on, the
 * rule's occurrences are also projected forward from that date, even when it is overdue
 * from an earlier month, so this month's occurrence can be posted without first clearing
 * the missed one. Months before the current one show only the outstanding occurrence.
 */
export function recurringOccurrenceInMonth(
  rule: Pick<RecurringForecastRule, "cadence" | "nextExpectedDate" | "endDate">,
  ym: string,
  currentYm: string,
): Date | null {
  const nextYm = ymdFromDateUtc(rule.nextExpectedDate).slice(0, 7);
  if (nextYm === ym) return rule.nextExpectedDate;
  if (nextYm > ym || ym < currentYm) return null;
  const occurrence = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, dateFromYmd(`${ym}-01`));
  const occurrenceYmd = ymdFromDateUtc(occurrence);
  if (rule.endDate && occurrenceYmd > ymdFromDateUtc(rule.endDate)) return null;
  return occurrenceYmd.slice(0, 7) === ym ? occurrence : null;
}

/**
 * Whether `expectedDate` is an occurrence of the rule on or after its outstanding one:
 * `nextExpectedDate` itself, or a later date its cadence lands on. Posting or skipping a
 * later occurrence passes over the ones before it.
 */
export function isRecurringOccurrenceOnOrAfterNext(
  nextExpectedDate: Date,
  cadence: RecurringCadence,
  expectedDate: Date,
): boolean {
  const expectedYmd = ymdFromDateUtc(expectedDate);
  return ymdFromDateUtc(advanceRecurringDateOnOrAfter(nextExpectedDate, cadence, expectedDate)) === expectedYmd;
}

export type RecurringCashFlowSummary = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

/** The `count` calendar months immediately before `anchorYm` (not including `anchorYm`). */
export function getPastMonthYmsBefore(anchorYm: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftYm(anchorYm, index - count));
}

export function bucketIncomeCentsByYm(
  transactions: ReadonlyArray<{ amountCents: number; date: Date }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const txn of transactions) {
    const ym = ymdFromDateUtc(txn.date).slice(0, 7);
    totals.set(ym, (totals.get(ym) ?? 0) + txn.amountCents);
  }
  return totals;
}

export function computeThreeMonthAverageIncomeCents(
  monthYms: readonly string[],
  incomeByYm: ReadonlyMap<string, number>,
): number {
  if (monthYms.length === 0) return 0;
  let sum = 0;
  for (const ym of monthYms) {
    sum += incomeByYm.get(ym) ?? 0;
  }
  return Math.round(sum / monthYms.length);
}

export function computeRecurringCashFlowSummary(
  rules: RecurringForecastRule[],
  period: { start: Date; endExclusive: Date },
  options?: { expectedIncomeCents: number },
): RecurringCashFlowSummary {
  let incomeFromRulesCents = 0;
  let expenseCents = 0;
  const periodEndYmd = ymdFromDateUtc(period.endExclusive);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let occurrence = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, period.start);
    let guard = 0;
    while (ymdFromDateUtc(occurrence) < periodEndYmd && guard < 1040) {
      if (rule.endDate && ymdFromDateUtc(occurrence) > ymdFromDateUtc(rule.endDate)) break;
      if (rule.type === "INCOME") {
        incomeFromRulesCents += rule.amountCents;
      } else {
        expenseCents += rule.amountCents;
      }
      occurrence = advanceRecurringDate(occurrence, rule.cadence);
      guard++;
    }
  }

  const incomeCents = options?.expectedIncomeCents ?? incomeFromRulesCents;

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
  };
}
