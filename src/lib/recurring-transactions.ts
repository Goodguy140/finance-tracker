import type { RecurringCadence, TransactionType } from "@prisma/client";
import { ymdFromDateUtc } from "./date-only";

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

export type RecurringCashFlowSummary = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

export function computeRecurringCashFlowSummary(
  rules: RecurringForecastRule[],
  period: { start: Date; endExclusive: Date },
): RecurringCashFlowSummary {
  let incomeCents = 0;
  let expenseCents = 0;
  const periodEndYmd = ymdFromDateUtc(period.endExclusive);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let occurrence = advanceRecurringDateOnOrAfter(rule.nextExpectedDate, rule.cadence, period.start);
    let guard = 0;
    while (ymdFromDateUtc(occurrence) < periodEndYmd && guard < 1040) {
      if (rule.endDate && ymdFromDateUtc(occurrence) > ymdFromDateUtc(rule.endDate)) break;
      if (rule.type === "INCOME") {
        incomeCents += rule.amountCents;
      } else {
        expenseCents += rule.amountCents;
      }
      occurrence = advanceRecurringDate(occurrence, rule.cadence);
      guard++;
    }
  }

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
  };
}
