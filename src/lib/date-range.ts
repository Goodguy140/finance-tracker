import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";

/**
 * A custom date range picked by the user (`from` and `to`, both `YYYY-MM-DD` and both included),
 * shared by the dashboard's period filter and Reports.
 */

export type CustomDateRange = { fromYmd: string; toYmd: string };

/** Longest range accepted; past it the dashboard's monthly charts stop being readable. */
export const MAX_CUSTOM_RANGE_YEARS = 20;

function realYmd(raw: string | undefined | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = dateFromYmd(raw);
  // Rejects dates that roll over, like 2026-02-30.
  return Number.isNaN(date.getTime()) || ymdFromDateUtc(date) !== raw ? null : raw;
}

/** Both ends valid, in order, and not absurdly far apart; otherwise null. */
export function parseCustomRange(from: string | undefined | null, to: string | undefined | null): CustomDateRange | null {
  const fromYmd = realYmd(from);
  const toYmd = realYmd(to);
  if (!fromYmd || !toYmd || fromYmd > toYmd) return null;
  if (Number(toYmd.slice(0, 4)) - Number(fromYmd.slice(0, 4)) > MAX_CUSTOM_RANGE_YEARS) return null;
  return { fromYmd, toYmd };
}

/** The first day after the range, for an exclusive `lt` bound. */
export function dayAfter(ymd: string): Date {
  const d = dateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const dayMonth = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 3 – 20, 2026", "Sep 28 – Oct 4, 2026" or "Dec 20, 2025 – Jan 5, 2026". */
export function formatCustomRange({ fromYmd, toYmd }: CustomDateRange): string {
  const from = dateFromYmd(fromYmd);
  const to = dateFromYmd(toYmd);
  if (fromYmd === toYmd) return dayMonthYear.format(from);
  if (fromYmd.slice(0, 4) !== toYmd.slice(0, 4)) return `${dayMonthYear.format(from)} – ${dayMonthYear.format(to)}`;
  if (fromYmd.slice(0, 7) === toYmd.slice(0, 7)) {
    return `${dayMonth.format(from)} – ${to.getUTCDate()}, ${toYmd.slice(0, 4)}`;
  }
  return `${dayMonth.format(from)} – ${dayMonthYear.format(to)}`;
}

/** The `period` key Reports carries in links: `2026-10-03_2026-10-20`. */
export function customRangeKey(range: CustomDateRange): string {
  return `${range.fromYmd}_${range.toYmd}`;
}

export function parseCustomRangeKey(key: string | undefined | null): CustomDateRange | null {
  const match = key ? /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key) : null;
  return match ? parseCustomRange(match[1], match[2]) : null;
}
