/**
 * Day sections for the Expense Log and Income lists: rows sit under a date header, the way
 * Copilot and Monarch lay out a register, so the date is read once per day instead of being
 * repeated on every row.
 */

export type TransactionDay<T> = {
  dateYmd: string;
  /** The server-formatted date of the day's first item ("Mon, Oct 12, 2026"). */
  dateDisplay: string;
  items: T[];
};

/**
 * Buckets items by their day, keeping each day where its first item was. The lists arrive
 * newest first, so this is the order they are shown in; an out-of-order item still joins
 * its own day rather than starting a second section for the same date.
 */
export function groupTransactionsByDay<T>(
  items: readonly T[],
  dayOf: (item: T) => { dateYmd: string; dateDisplay: string },
): TransactionDay<T>[] {
  const days: TransactionDay<T>[] = [];
  const byYmd = new Map<string, TransactionDay<T>>();
  for (const item of items) {
    const { dateYmd, dateDisplay } = dayOf(item);
    let day = byYmd.get(dateYmd);
    if (!day) {
      day = { dateYmd, dateDisplay, items: [] };
      byYmd.set(dateYmd, day);
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

/**
 * A day's total in the home currency. Rows on an account in another currency are left
 * out, as they are from every other total; null when the day has none in the home currency.
 */
export function homeCurrencyDayTotal(
  entries: readonly { amountCents: number; currency?: string | null }[],
): number | null {
  let total = 0;
  let any = false;
  for (const entry of entries) {
    if (entry.currency) continue;
    total += entry.amountCents;
    any = true;
  }
  return any ? total : null;
}
