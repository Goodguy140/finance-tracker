import { describe, expect, it } from 'vitest';

import type { Reports } from '@/api/types';
import { barExtent, belowZeroLines, changeText, hasReports, incomeSpendingBars, netWorthBars, projectionTiles, reportsPath, totalsTiles } from './reports';

describe('hasReports', () => {
  it('waits for a server that lists reports', () => {
    expect(hasReports({ features: ['rules', 'reports'] })).toBe(true);
    expect(hasReports({ features: ['rules'] })).toBe(false);
    expect(hasReports(undefined)).toBe(false);
  });
});

describe('reportsPath', () => {
  it('asks for the default period plainly, a year or a range by name, and a tag', () => {
    expect(reportsPath({ kind: 'option', key: '12m' }, null)).toBe('/api/v1/reports');
    expect(reportsPath({ kind: 'option', key: '2025' }, 'tag1')).toBe('/api/v1/reports?period=2025&tagId=tag1');
    expect(reportsPath({ kind: 'custom', from: '2026-01-01', to: '2026-03-31' }, null)).toBe('/api/v1/reports?from=2026-01-01&to=2026-03-31');
  });
});

describe('totalsTiles', () => {
  it('says saved from income less spending when no account counts as savings', () => {
    const tiles = totalsTiles({ incomeCents: 300_000, spendingCents: 320_000, netCents: -20_000, toSavingsCents: null }, 'USD');
    expect(tiles.map((t) => t.label)).toEqual(['Income', 'Spending', 'Overspent']);
    expect(tiles[2].value).toBe('$200.00');
  });

  it('shows left over and saved apart once savings accounts are marked', () => {
    const tiles = totalsTiles({ incomeCents: 300_000, spendingCents: 50_000, netCents: 250_000, toSavingsCents: -10_000 }, 'USD');
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Income', '$3,000.00'],
      ['Spending', '$500.00'],
      ['Left over', '$2,500.00'],
      ['Taken from savings', '$100.00'],
    ]);
  });
});

describe('bars', () => {
  const months: Reports['months'] = [{ ym: '2026-10', label: 'Oct', incomeCents: 300_000, spendingCents: 340_000, netCents: -40_000, toSavingsCents: null }];

  it('says what a month held when it is tapped', () => {
    expect(incomeSpendingBars(months, 'USD')[0].caption).toBe('Oct: $3,000.00 in, $3,400.00 out, $400.00 overspent');
  });

  it('keeps zero in range, so a negative net worth hangs below the line', () => {
    const bars = netWorthBars([{ ym: '2026-10', label: 'Oct', netCents: -5_000, assetsCents: 1_000, liabilitiesCents: 6_000 }], 'USD');
    expect(bars[0].values[0].tone).toBe('danger');
    expect(barExtent(bars)).toEqual({ max: 0, min: -5_000 });
    expect(barExtent(incomeSpendingBars(months, 'USD'))).toEqual({ max: 340_000, min: 0 });
  });
});

describe('changeText', () => {
  it('reads as the website’s Change column', () => {
    expect(changeText(0.124)).toBe('+12%');
    expect(changeText(-0.08)).toBe('−8%');
    expect(changeText(null)).toBe('New');
  });
});

describe('projection', () => {
  const projection: NonNullable<Reports['projection']> = {
    days: [30, 60, 90],
    netCents: [50_000, 40_000, 60_000, -10_000],
    includesTransfers: false,
    rulesLeftOut: 0,
    accounts: [
      { accountId: 'a', name: 'Chequing', liability: false, currentCents: 50_000, asOf: '2026-11-14', projectedCents: [], belowZero: { date: '2026-12-03', lowestCents: -70_000 } },
      { accountId: 'b', name: 'Savings', liability: false, currentCents: 0, asOf: '2026-11-14', projectedCents: [], belowZero: null },
    ],
  };

  it('gives each horizon with its change from today', () => {
    expect(projectionTiles(projection, 'USD').map((t) => t.value)).toEqual(['$500.00', '$400.00 (−$100.00)', '$600.00 (+$100.00)', '-$100.00 (−$600.00)']);
  });

  it('names only the accounts that go below zero', () => {
    expect(belowZeroLines(projection, 'USD')).toEqual(['Chequing goes below zero on Thu, Dec 3 and reaches -$700.00.']);
  });
});
