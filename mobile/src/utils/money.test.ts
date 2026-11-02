import { describe, expect, it } from 'vitest';

import { formatCents, formatPeriodMonth } from '@/utils/money';

describe('formatCents', () => {
  it('formats cents in the currency', () => {
    expect(formatCents(123456, 'CAD', 'en-CA')).toBe('$1,234.56');
    expect(formatCents(-500, 'USD', 'en-US')).toBe('-$5.00');
  });

  it('falls back to plain digits for a code Intl does not know', () => {
    expect(formatCents(1050, 'not-a-currency')).toBe('10.50 not-a-currency');
  });
});

describe('formatPeriodMonth', () => {
  it('names the month', () => {
    expect(formatPeriodMonth('2026-11', 'en-CA')).toBe('November 2026');
    expect(formatPeriodMonth('lifetime')).toBe('lifetime');
  });
});
