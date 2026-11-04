import { describe, expect, it } from 'vitest';

import type { Summary } from '@/api/types';
import { billsWidgetProps, safeToSpendWidgetProps } from '@/utils/widgets';

const NOW = new Date(2026, 10, 4, 15, 40);

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    month: '2026-11',
    today: '2026-11-04',
    currency: 'USD',
    safeToSpend: {
      safeCents: 123456,
      perDayCents: 4500,
      daysLeft: 27,
      incomeReceivedCents: 0,
      spentCents: 0,
      expectedIncomeCents: 0,
      billsDueCents: 0,
      budgetLeftCents: 0,
      goalsCents: 0,
    },
    budgets: { count: 0, totalLimitCents: 0, totalSpentCents: 0, watch: [] },
    upcoming: { days: 7, items: [], billsCents: 0, incomeCents: 0 },
    waiting: { bankQueue: 0, needsReview: 0 },
    ...overrides,
  };
}

describe('safeToSpendWidgetProps', () => {
  it('writes the amount, the per-day line and when it was worked out', () => {
    const props = safeToSpendWidgetProps(summary(), NOW, 'en-US');
    expect(props).toMatchObject({ amount: '$1,234.56', negative: false, perDay: 'About $45.00 a day for 27 days.' });
    expect(props.asOf).toMatch(/^As of 3:40/);
  });

  it('flags an over-committed month', () => {
    const over = summary({ safeToSpend: { ...summary().safeToSpend, safeCents: -5000 } });
    expect(safeToSpendWidgetProps(over, NOW, 'en-US')).toMatchObject({ negative: true, perDay: 'Over-committed by $50.00 for the rest of the month.' });
  });
});

describe('billsWidgetProps', () => {
  it('lists bills and pay with written-out days, never "Tomorrow"', () => {
    const props = billsWidgetProps(
      summary({
        upcoming: {
          days: 7,
          items: [
            { date: '2026-11-01', name: 'Phone', type: 'expense', amountCents: 6500, overdue: true, planned: false },
            { date: '2026-11-05', name: 'Pay', type: 'income', amountCents: 150000, overdue: false, planned: true },
          ],
          billsCents: 6500,
          incomeCents: 150000,
        },
      }),
      NOW,
      'en-US',
    );
    expect(props.title).toBe('Next 7 days');
    expect(props.rows).toEqual([
      { day: 'Overdue since Sun, Nov 1', name: 'Phone', amount: '$65.00', income: false, overdue: true },
      { day: 'Thu, Nov 5', name: 'Pay (planned)', amount: '+$1,500.00', income: true, overdue: false },
    ]);
    expect(props.totals).toBe('Bills $65.00 · Pay $1,500.00');
  });

  it('says so when nothing is due, with an empty list rather than none', () => {
    const props = billsWidgetProps(summary(), NOW, 'en-US');
    expect(props.rows).toEqual([]);
    expect(props.empty).toBe('Nothing due in the next 7 days.');
    expect(props.totals).toBe('');
  });
});
