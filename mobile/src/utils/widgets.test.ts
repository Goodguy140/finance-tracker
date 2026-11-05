import { describe, expect, it } from 'vitest';

import type { Summary } from '@/api/types';
import { billsWidgetProps, safeToSpendWidgetProps } from '@/utils/widgets';
import { SIGNED_OUT_BILLS, SIGNED_OUT_SAFE_TO_SPEND } from '@/widgets/signed-out';

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

/**
 * Why a value can't be stored in UserDefaults, where widget props are kept: it takes strings,
 * numbers, booleans, lists and objects of those, and refuses anything else. A null in the props
 * the widgets start with crashed build 12 on launch.
 */
function propertyListProblems(value: unknown, path = 'props'): string[] {
  if (typeof value === 'string' || typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path} is ${value}`];
  if (Array.isArray(value)) return value.flatMap((item, index) => propertyListProblems(item, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => propertyListProblems(item, `${path}.${key}`));
  }
  return [`${path} is ${String(value)}`];
}

describe('widget props', () => {
  it('hold only values iOS can store, signed in or out: no null or undefined anywhere', () => {
    const busy = summary({
      upcoming: {
        days: 7,
        items: [{ date: '2026-11-05', name: 'Rent', type: 'expense', amountCents: 120000, overdue: false, planned: false }],
        billsCents: 120000,
        incomeCents: 0,
      },
    });
    const all = {
      signedOutSafeToSpend: SIGNED_OUT_SAFE_TO_SPEND,
      signedOutBills: SIGNED_OUT_BILLS,
      safeToSpend: safeToSpendWidgetProps(busy, NOW, 'en-US'),
      bills: billsWidgetProps(busy, NOW, 'en-US'),
      noBills: billsWidgetProps(summary(), NOW, 'en-US'),
    };
    expect(propertyListProblems(all)).toEqual([]);
    expect([SIGNED_OUT_SAFE_TO_SPEND.ready, SIGNED_OUT_BILLS.ready, all.safeToSpend.ready, all.bills.ready]).toEqual([false, false, true, true]);
  });
});
