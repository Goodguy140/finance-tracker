import { describe, expect, it } from 'vitest';

import { owedSummary, splitOwed, type OwedItem } from './owed';

const item = (name: string, amountCents: number, paidAt: string | null = null): OwedItem => ({
  id: `${name}-${amountCents}`,
  name,
  amountCents,
  currency: 'USD',
  transactionId: 't1',
  expenseLabel: 'Dinner',
  expenseDate: '2026-11-02',
  paidAt,
});

describe('owed to you', () => {
  it('counts each person once and leaves out who paid back', () => {
    const items = [item('Sam', 3_000), item('sam ', 1_000), item('Alex', 2_000, '2026-11-04T00:00:00Z')];
    expect(owedSummary({ items, outstandingCents: 4_000, currency: 'USD' })).toBe('$40.00 from 1 person');
    expect(owedSummary({ items: [items[2]], outstandingCents: 0, currency: 'USD' })).toBeNull();
    expect(splitOwed(items).repaid.map((i) => i.name)).toEqual(['Alex']);
  });
});
