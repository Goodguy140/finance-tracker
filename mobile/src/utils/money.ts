/** Cents as the person's currency, e.g. 123456 CAD → "$1,234.56" (the locale decides the symbol). */
export function formatCents(cents: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "2026-11" → "November 2026". */
export function formatPeriodMonth(periodMonth: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) return periodMonth;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
