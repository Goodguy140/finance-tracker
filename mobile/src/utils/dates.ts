/** Dates as the server sends them: `YYYY-MM-DD` days and `YYYY-MM` months, with no time zone. */

function utcDate(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

/** "2026-11-05" → "Thu, Nov 5". */
export function formatDay(ymd: string, locale?: string): string {
  const date = utcDate(ymd);
  if (!date) return ymd;
  return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Today", "Tomorrow", "Yesterday", or the day as `formatDay` writes it. */
export function relativeDay(ymd: string, todayYmd: string, locale?: string): string {
  const day = utcDate(ymd);
  const today = utcDate(todayYmd);
  if (day && today) {
    const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
  }
  return formatDay(ymd, locale);
}

/** "2026-11" moved by `delta` months: shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** This month on the phone's own calendar, `YYYY-MM`. */
export function localMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Today on the phone's own calendar, `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  return `${localMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * A `YYYY-MM-DD` day as a Date at midnight UTC, for a date picker told to show UTC: the day the
 * person sees is the day stored, whatever time zone the phone is in.
 */
export function dateFromYmd(ymd: string): Date {
  return utcDate(ymd) ?? new Date(NaN);
}

/** The UTC calendar day of a date picker's Date, `YYYY-MM-DD`. */
export function ymdFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
