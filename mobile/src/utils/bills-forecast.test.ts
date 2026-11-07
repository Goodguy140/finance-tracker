import { describe, expect, it } from 'vitest';

import type { ForecastEntry } from '@/api/types';

import { entryAmount, entryChips, entryDetail, forecastPath, signedCents } from './bills-forecast';

function entry(overrides: Partial<ForecastEntry> = {}): ForecastEntry {
  return {
    key: 'r1:2026-03-12',
    sourceId: 'r1',
    name: 'Streaming',
    type: 'expense',
    amountCents: 1_500,
    overdue: false,
    missedSince: null,
    planned: false,
    label: 'Fun',
    card: null,
    decideBy: null,
    ...overrides,
  };
}

describe('upcoming bills', () => {
  it('asks for the days and whether to list transfers', () => {
    expect(forecastPath(60, false)).toBe('/api/v1/bills/forecast?days=60&transfers=false');
  });

  it('signs the running net and the amounts as the website does', () => {
    expect(signedCents(68_500, 'USD')).toBe('+$685.00');
    expect(signedCents(-1_500, 'USD')).toBe('-$15.00');
    expect(entryAmount(entry(), 'USD')).toBe('-$15.00');
    expect(entryAmount(entry({ type: 'income', amountCents: 300_000 }), 'USD')).toBe('+$3,000.00');
    expect(entryAmount(entry({ type: 'transfer', amountCents: null, card: { owedCents: null, minimumCents: null } }), 'USD')).toBe('Due');
  });

  it("describes a card's payment from what is known about it", () => {
    const card = (owedCents: number | null, minimumCents: number | null) =>
      entryDetail(entry({ type: 'transfer', label: '', card: { owedCents, minimumCents } }), 'USD');
    expect(card(40_000, 2_500)).toBe('Balance owed, minimum $25.00');
    expect(card(40_000, null)).toBe('Balance owed');
    expect(card(null, 2_500)).toBe('Minimum payment');
    expect(card(null, null)).toBe('No balance recorded');
    expect(entryDetail(entry({ type: 'transfer', label: 'Chequing to Savings' }), 'USD')).toBe('Chequing to Savings');
  });

  it('shows the chips in the website order', () => {
    expect(entryChips(entry({ decideBy: '2026-04-01', planned: true, overdue: true, missedSince: '2026-02-12' })).map((c) => c.text)).toEqual([
      'Decide by Apr 1, 2026',
      'Planned',
      'Overdue',
      'Unposted since Feb 12, 2026',
    ]);
    expect(entryChips(entry({ type: 'transfer', card: { owedCents: 1, minimumCents: null } })).map((c) => c.text)).toEqual(['Card payment']);
    expect(entryChips(entry({ type: 'transfer' })).map((c) => c.text)).toEqual(['Transfer']);
  });
});
