import type { RecurringCadence, TransactionType } from "@prisma/client";
import { shiftYm } from "./dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

/**
 * Add calendar months in UTC, clamping the day (e.g. Jan 31 + 1 month -> Feb 28). `day` is the
 * day of the month to aim for, which defaults to `date`'s own; pass a rule's anchor day so a
 * date already clamped (Feb 28) does not carry the clamp into later months.
 */
export function addUtcMonths(date: Date, months: number, day: number = date.getUTCDate()): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const targetMonth = m + months;
  const anchor = new Date(Date.UTC(y, targetMonth, 1));
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  const dayClamped = Math.min(day, lastDay);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), dayClamped));
}

/**
 * The day of the month a monthly, quarterly, yearly or biennial rule falls on. Stored as
 * `anchorDay` because `nextExpectedDate` cannot hold it: a rule on the 31st sits on Feb 28 for
 * a month, and advancing from there alone would keep it on the 28th from then on. A rule saved
 * before the column existed has none, and its outstanding date's day stands in.
 */
export function recurringAnchorDay(rule: { anchorDay?: number | null; nextExpectedDate: Date }): number {
  return rule.anchorDay ?? rule.nextExpectedDate.getUTCDate();
}

/** The two days a twice-a-month rule falls on; 31 is the last day of any month. */
export type SemiMonthlyDays = { day: number; secondDay: number; beforeWeekend: boolean };

/** Paid on the 15th and the last day: the usual Canadian semi-monthly payroll. */
export const DEFAULT_SEMI_MONTHLY_DAYS: SemiMonthlyDays = { day: 15, secondDay: 31, beforeWeekend: false };

/** The days must be a week apart, so even clamped to February and moved off a weekend they stay apart and in order. */
export const SEMI_MONTHLY_MIN_GAP_DAYS = 7;

export function isValidSemiMonthlyDays(day: number, secondDay: number): boolean {
  return (
    Number.isInteger(day) &&
    Number.isInteger(secondDay) &&
    day >= 1 &&
    secondDay <= 31 &&
    secondDay - day >= SEMI_MONTHLY_MIN_GAP_DAYS
  );
}

/**
 * Where a rule's occurrences land, as the date functions below take it: a day of the month,
 * or a twice-a-month rule's two days.
 */
export type RecurringAnchor = number | SemiMonthlyDays;

export type RecurringAnchorFields = {
  cadence: RecurringCadence;
  anchorDay?: number | null;
  secondAnchorDay?: number | null;
  beforeWeekend?: boolean | null;
  nextExpectedDate: Date;
};

/** A rule's anchor: its two days if it is twice a month, otherwise its day (`recurringAnchorDay`). */
export function recurringAnchor(rule: RecurringAnchorFields): RecurringAnchor {
  if (rule.cadence !== "SEMI_MONTHLY") return recurringAnchorDay(rule);
  return {
    day: rule.anchorDay ?? DEFAULT_SEMI_MONTHLY_DAYS.day,
    secondDay: rule.secondAnchorDay ?? DEFAULT_SEMI_MONTHLY_DAYS.secondDay,
    beforeWeekend: rule.beforeWeekend ?? false,
  };
}

/** A twice-a-month rule's days, for a form or a label; null for any other cadence. */
export function semiMonthlyDaysOfRule(rule: RecurringAnchorFields): SemiMonthlyDays | null {
  const anchor = recurringAnchor(rule);
  return typeof anchor === "number" ? null : anchor;
}

function ordinalDay(day: number): string {
  if (day >= 31) return "last day";
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

/** "15th and last day", with "(Friday before weekends)" when dates move off a weekend. */
export function semiMonthlyDaysLabel(days: SemiMonthlyDays): string {
  const label = `${ordinalDay(days.day)} and ${ordinalDay(days.secondDay)}`;
  return days.beforeWeekend ? `${label} (Friday before weekends)` : label;
}

function semiMonthlyDaysOf(anchor: RecurringAnchor): SemiMonthlyDays {
  return typeof anchor === "number" ? DEFAULT_SEMI_MONTHLY_DAYS : anchor;
}

function dayOfMonthAnchor(anchor: RecurringAnchor): number {
  return typeof anchor === "number" ? anchor : anchor.day;
}

/** Saturday and Sunday move back to the Friday before. */
function fridayBeforeWeekend(date: Date): Date {
  const weekday = date.getUTCDay();
  if (weekday !== 0 && weekday !== 6) return date;
  const moved = new Date(date.getTime());
  moved.setUTCDate(moved.getUTCDate() - (weekday === 6 ? 1 : 2));
  return moved;
}

/**
 * A twice-a-month rule's next occurrence strictly after `date`. Its dates are worked out from the
 * month rather than from `date`, which may sit on the Friday before a weekend (or in the month
 * before, when the 1st was a Saturday): the earliest of this and the next two months' dates
 * that is later than `date`.
 */
function nextSemiMonthlyDate(date: Date, days: SemiMonthlyDays): Date {
  const ymd = ymdFromDateUtc(date);
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  for (let months = 0; months < 3; months++) {
    for (const day of [days.day, days.secondDay]) {
      const nominal = addUtcMonths(monthStart, months, day);
      const candidate = days.beforeWeekend ? fridayBeforeWeekend(nominal) : nominal;
      if (ymdFromDateUtc(candidate) > ymd) return candidate;
    }
  }
  // Unreachable: two months on is always later than `date`.
  return addUtcMonths(monthStart, 2, days.day);
}

/** The occurrence after `date`. Month-based cadences land on `anchorDay`, clamped to the month. */
export function advanceRecurringDate(
  date: Date,
  cadence: RecurringCadence,
  anchor: RecurringAnchor = date.getUTCDate(),
): Date {
  const next = new Date(date.getTime());
  const anchorDay = dayOfMonthAnchor(anchor);
  switch (cadence) {
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "BIWEEKLY":
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case "SEMI_MONTHLY":
      return nextSemiMonthlyDate(date, semiMonthlyDaysOf(anchor));
    case "MONTHLY":
      return addUtcMonths(date, 1, anchorDay);
    case "QUARTERLY":
      return addUtcMonths(date, 3, anchorDay);
    case "YEARLY":
      return addUtcMonths(date, 12, anchorDay);
    case "BIENNIAL":
      return addUtcMonths(date, 24, anchorDay);
  }
}

/**
 * A twice-a-month rule's first occurrence on or after `date`, which is where a rule saved with
 * any start date begins: the 3rd with days 15 and last begins on the 15th.
 */
export function firstSemiMonthlyDateOnOrAfter(date: Date, days: SemiMonthlyDays): Date {
  const dayBefore = new Date(date.getTime());
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return nextSemiMonthlyDate(dayBefore, days);
}

export function advanceRecurringDateOnOrAfter(
  nextExpectedDate: Date,
  cadence: RecurringCadence,
  onOrAfter: Date,
  anchor: RecurringAnchor = nextExpectedDate.getUTCDate(),
): Date {
  let date = new Date(nextExpectedDate.getTime());
  const targetYmd = ymdFromDateUtc(onOrAfter);
  let guard = 0;
  while (ymdFromDateUtc(date) < targetYmd && guard < 1040) {
    date = advanceRecurringDate(date, cadence, anchor);
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
  anchorDay?: number | null;
  secondAnchorDay?: number | null;
  beforeWeekend?: boolean | null;
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
  rule: Pick<RecurringForecastRule, "cadence" | "nextExpectedDate" | "anchorDay" | "secondAnchorDay" | "beforeWeekend" | "endDate">,
  ym: string,
  currentYm: string,
): Date | null {
  const nextYm = ymdFromDateUtc(rule.nextExpectedDate).slice(0, 7);
  if (nextYm === ym) return rule.nextExpectedDate;
  if (nextYm > ym || ym < currentYm) return null;
  const occurrence = advanceRecurringDateOnOrAfter(
    rule.nextExpectedDate,
    rule.cadence,
    dateFromYmd(`${ym}-01`),
    recurringAnchor(rule),
  );
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
  anchor: RecurringAnchor = nextExpectedDate.getUTCDate(),
): boolean {
  const expectedYmd = ymdFromDateUtc(expectedDate);
  return (
    ymdFromDateUtc(advanceRecurringDateOnOrAfter(nextExpectedDate, cadence, expectedDate, anchor)) === expectedYmd
  );
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

    const anchor = recurringAnchor(rule);
    let occurrence = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, period.start, anchor);
    let guard = 0;
    while (ymdFromDateUtc(occurrence) < periodEndYmd && guard < 1040) {
      if (rule.endDate && ymdFromDateUtc(occurrence) > ymdFromDateUtc(rule.endDate)) break;
      // A transfer moves money between the user's own accounts: neither income nor a bill.
      if (rule.type === "INCOME") {
        incomeFromRulesCents += rule.amountCents;
      } else if (rule.type === "EXPENSE") {
        expenseCents += rule.amountCents;
      }
      occurrence = advanceRecurringDate(occurrence, rule.cadence, anchor);
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
