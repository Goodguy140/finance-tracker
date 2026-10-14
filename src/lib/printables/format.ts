import { formatYmShortLabel } from "@/lib/dashboard-period";
import { formatCurrency } from "@/lib/money";
import type { GoalStatus } from "@/lib/savings-goals";

/** Printed dates are always English and unambiguous: "Oct 15, 2026". */
const LOCALE = "en-CA";

export function moneyFormatter(currency: string) {
  return (cents: number) => formatCurrency(cents, currency, LOCALE);
}

/** "Oct 15, 2026" for a date-only value (midnight UTC). */
export function printDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "Thu, Oct 15" for a date-only value. */
export function printDay(date: Date): string {
  return date.toLocaleDateString(LOCALE, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function printYmd(ymd: string): string {
  return printDate(new Date(`${ymd}T00:00:00Z`));
}

/** "October 2026". */
export function printMonth(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(LOCALE, { timeZone: "UTC", month: "long", year: "numeric" });
}

export function printMonthShort(ym: string): string {
  return formatYmShortLabel(ym);
}

export function printChange(ratio: number | null): string {
  if (ratio === null) return "new";
  const pct = Math.round(ratio * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export const GOAL_STATUS_TEXT: Record<GoalStatus, string> = {
  reached: "Reached",
  "on-track": "On track",
  behind: "Behind",
  overdue: "Past its date",
  needs: "Has a date",
  open: "No date",
  "no-balance": "No balance yet",
};

/** File names carry the date they were made, so a stack of printouts sorts itself. */
export function printFileName(base: string, todayYmd: string, extension: "pdf" | "csv"): string {
  return `${base}-${todayYmd}.${extension}`;
}
