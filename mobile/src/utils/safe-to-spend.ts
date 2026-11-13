import type { Me, SafeToSpend, SafeToSpendSettings } from '@/api/types';
import { formatCents } from '@/utils/money';

export const SAFE_TO_SPEND_PATH = '/api/v1/safe-to-spend';

/** The server takes the bill buffer from the phone (`/api/v1/safe-to-spend`). */
export function canSetSafeToSpendBuffer(me: Me | undefined): boolean {
  return me?.features?.includes('safe-to-spend-buffer') ?? false;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Dec 4" for `2026-12-04`, as the website's card names the buffer's last day. */
function shortDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}

/** The line under the big number, worded as the website's Safe to spend card words it. */
export function safeToSpendLine(data: SafeToSpend, currency: string): string {
  if (data.safeCents < 0) return `Over-committed by ${formatCents(-data.safeCents, currency)} for the rest of the month.`;
  return `About ${formatCents(data.perDayCents, currency)} a day for ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}.`;
}

/** What the buffer adds, when it reaches into next month: "Also holding back next month's bills due by Dec 4 (7-day buffer)." */
export function safeToSpendBufferLine(data: SafeToSpend): string | null {
  if (!data.bufferUntilYmd) return null;
  return `Also holding back next month's bills due by ${shortDay(data.bufferUntilYmd)} (${data.bufferDays}-day buffer).`;
}

/** How the number is worked out, row by row, as on the website. */
export function safeToSpendBreakdown(data: SafeToSpend): { label: string; cents: number; sign: '+' | '-' }[] {
  return [
    { label: 'Income received', cents: data.incomeReceivedCents, sign: '+' },
    { label: 'Spent so far', cents: data.spentCents, sign: '-' },
    { label: 'Income still expected', cents: data.expectedIncomeCents, sign: '+' },
    { label: 'Bills still due', cents: data.billsDueCents, sign: '-' },
    ...(data.bufferUntilYmd
      ? [{ label: `Next month's bills to ${shortDay(data.bufferUntilYmd)}`, cents: data.bufferBillsCents ?? 0, sign: '-' as const }]
      : []),
    { label: 'Left in budgets', cents: data.budgetLeftCents, sign: '-' },
    { label: 'Savings goals this month', cents: data.goalsCents, sign: '-' },
  ];
}

/** The buffer field as it shows a saved value: empty while the buffer is off. */
export function bufferDaysText(days: number | null): string {
  return days === null ? '' : String(days);
}

/** The body `PATCH /api/v1/safe-to-spend` takes. */
export type BufferDaysPatch = Pick<SafeToSpendSettings, 'bufferDays'>;

/**
 * What leaving the buffer field asks for: the `PATCH` body to send (`bufferDays` null turns the
 * buffer off, the field emptied), nothing when it still says what is saved, or why it can't be saved.
 */
export function bufferDaysChange(
  text: string,
  saved: number | null,
  max: number,
): BufferDaysPatch | { error: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return saved === null ? null : { bufferDays: null };
  const days = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || days < 1 || days > max) {
    return { error: `Enter a whole number of days from 1 to ${max}, or leave it empty for none.` };
  }
  return days === saved ? null : { bufferDays: days };
}

/** One line on what the buffer does now. */
export function bufferNote(days: number | null): string {
  if (days === null) return 'No buffer: Safe to spend holds back the bills due by month end.';
  return `Safe to spend holds back the bills due by month end, and next month's bills due within ${days} day${days === 1 ? '' : 's'} of today.`;
}
