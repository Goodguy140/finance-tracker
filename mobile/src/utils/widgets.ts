import type { Summary } from '@/api/types';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';
import { safeToSpendLine } from '@/utils/safe-to-spend';
import type { BillsWidgetProps } from '@/widgets/bills';
import type { SafeToSpendWidgetProps } from '@/widgets/safe-to-spend';

/**
 * The home screen widgets' props, formatted here because the widgets can't format anything
 * themselves. Days are written out ("Thu, Nov 6"), never "Tomorrow": a widget can sit unchanged
 * for days until the app is opened again, and a relative day would quietly become wrong.
 */

export function asOfLine(now: Date, locale?: string): string {
  return `As of ${now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
}

export function safeToSpendWidgetProps(summary: Summary, now: Date, locale?: string): SafeToSpendWidgetProps {
  const safe = summary.safeToSpend;
  return {
    amount: formatCents(safe.safeCents, summary.currency, locale),
    negative: safe.safeCents < 0,
    perDay: safeToSpendLine(safe, summary.currency),
    asOf: asOfLine(now, locale),
  };
}

export function billsWidgetProps(summary: Summary, now: Date, locale?: string): BillsWidgetProps {
  const { upcoming, currency } = summary;
  const money = (cents: number) => formatCents(cents, currency, locale);
  const totals = [
    upcoming.billsCents > 0 ? `Bills ${money(upcoming.billsCents)}` : null,
    upcoming.incomeCents > 0 ? `Pay ${money(upcoming.incomeCents)}` : null,
  ].filter((part) => part !== null);
  return {
    title: `Next ${upcoming.days} days`,
    rows: upcoming.items.map((item) => ({
      day: item.overdue ? `Overdue since ${formatDay(item.date, locale)}` : formatDay(item.date, locale),
      name: item.planned ? `${item.name} (planned)` : item.name,
      amount: `${item.type === 'income' ? '+' : ''}${money(item.amountCents)}`,
      income: item.type === 'income',
      overdue: item.overdue,
    })),
    empty: `Nothing due in the next ${upcoming.days} days.`,
    totals: totals.join(' · '),
    asOf: asOfLine(now, locale),
  };
}

/** What both widgets show before the app has loaded, and after signing out: no numbers at all. */
export const SIGNED_OUT_SAFE_TO_SPEND: SafeToSpendWidgetProps = { amount: null, negative: false, perDay: '', asOf: '' };
export const SIGNED_OUT_BILLS: BillsWidgetProps = { title: '', rows: null, empty: '', totals: '', asOf: '' };
