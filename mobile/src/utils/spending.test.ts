import { describe, expect, it } from 'vitest';

import type { Spending } from '@/api/types';

import {
  amountAxis,
  comparisonLine,
  dashedSegments,
  dayIndexAt,
  dayDetail,
  dayTicks,
  expectedGapLine,
  linePoints,
  savingsNote,
  sliceShares,
  spendingPath,
} from './spending';

function spending(overrides: Partial<Spending> = {}, cumulative: Partial<Spending['cumulative']> = {}): Spending {
  return {
    month: '2026-11',
    today: '2026-11-03',
    // Node writes CAD as CA$, which a Canadian phone does not; USD reads as $ everywhere.
    currency: 'USD',
    compareWith: 'none',
    showSavings: false,
    cumulative: {
      days: [
        { day: 1, spentCents: 1_000, totalCents: 1_000, expectedCents: 2_000, comparisonCents: 1_500 },
        { day: 2, spentCents: 0, totalCents: 1_000, expectedCents: 4_000, comparisonCents: 3_000 },
        { day: 3, spentCents: -500, totalCents: 500, expectedCents: 6_000, comparisonCents: 3_000 },
        { day: 4, spentCents: 0, totalCents: null, expectedCents: 8_000, comparisonCents: 3_000 },
      ],
      totalCents: 500,
      expectedBasis: 'budgets',
      expectedGapCents: -5_500,
      comparisonGapCents: -2_500,
      ...cumulative,
    },
    categories: { totalCents: 500, grouped: false, slices: [], savings: null },
    ...overrides,
  };
}

describe('spendingPath', () => {
  it('asks for the website card settings until the person picks, then for their picks', () => {
    expect(spendingPath({})).toBe('/api/v1/spending');
    expect(spendingPath({ compareWith: 'last-month', showSavings: false })).toBe('/api/v1/spending?compare=last-month&savings=0');
    expect(spendingPath({ showSavings: true })).toBe('/api/v1/spending?savings=1');
  });
});

describe('what the cumulative card says', () => {
  it('quotes the gap to the expected pace and to the comparison, over in red and under in green', () => {
    expect(expectedGapLine(spending())).toEqual({ text: '$55.00 under expected', tone: 'positive' });
    expect(expectedGapLine(spending({}, { expectedGapCents: 1_234 }))).toEqual({ text: '$12.34 over expected', tone: 'danger' });
    expect(expectedGapLine(spending({}, { expectedBasis: null, expectedGapCents: null }))).toBeNull();
    expect(comparisonLine(spending({ compareWith: 'three-month-average' }))).toEqual({
      text: '$25.00 less than the 3-month average',
      tone: 'positive',
    });
    expect(comparisonLine(spending())).toBeNull();
  });

  it('says so when the earlier month had nothing to compare with', () => {
    expect(comparisonLine(spending({ compareWith: 'last-month' }, { comparisonGapCents: null }))).toEqual({
      text: 'Nothing spent in last month to compare with.',
      tone: null,
    });
  });

  it('describes a picked day, and a day still to come as not yet', () => {
    expect(dayDetail(spending({ compareWith: 'last-month' }), 2)).toEqual({
      total: '$5.00',
      lines: ['Nov 3', '−$5.00 that day', '$60.00 expected', '$30.00 last month'],
    });
    expect(dayDetail(spending(), 3)).toEqual({ total: 'Not yet', lines: ['Nov 4', '$80.00 expected'] });
  });
});

describe('chart layout', () => {
  it('rounds the axis up to an even step that covers the highest line', () => {
    expect(amountAxis(123_456)).toEqual({ maxCents: 150_000, ticks: [0, 50_000, 100_000, 150_000] });
    expect(amountAxis(80_000)).toEqual({ maxCents: 80_000, ticks: [0, 20_000, 40_000, 60_000, 80_000] });
    // An empty month still gets an axis to draw.
    expect(amountAxis(0).maxCents).toBeGreaterThan(0);
  });

  it('labels the 1st and each week after, and the month end when it is not crowded', () => {
    expect(dayTicks(30)).toEqual([1, 8, 15, 22, 29]);
    expect(dayTicks(28)).toEqual([1, 8, 15, 22, 28]);
  });

  it('places the first day at the left and zero at the bottom, and stops a line where its values stop', () => {
    const runs = linePoints([0, 50, 100, null, null], 200, 100, 100);
    expect(runs).toEqual([
      [
        { x: 0, y: 100 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ],
    ]);
  });

  it('carries the dash pattern on round a corner', () => {
    // Two 10-long legs at a right angle, dashes 4 long with 2 between.
    const dashes = dashedSegments(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      4,
      2,
    );
    const drawn = dashes.reduce((sum, dash) => sum + dash.length, 0);
    // 4 and 4 on the first leg; the gap it ends in runs on round the corner, then 4 and 2 on the second.
    expect(drawn).toBeCloseTo(14);
    expect(Math.max(...dashes.map((dash) => dash.length))).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('picks the nearest day under a finger, never past either end', () => {
    expect(dayIndexAt(0, 290, 30)).toBe(0);
    expect(dayIndexAt(149, 290, 30)).toBe(15);
    expect(dayIndexAt(-20, 290, 30)).toBe(0);
    expect(dayIndexAt(400, 290, 30)).toBe(29);
  });
});

describe('what the pie card says', () => {
  it('sizes refunds by their amount, as the pie does', () => {
    expect(sliceShares([{ cents: 3_000 }, { cents: -1_000 }])).toEqual([75, 25]);
    expect(sliceShares([])).toEqual([]);
  });

  it('explains the Savings slice, and why there is none', () => {
    const categories = { totalCents: 0, grouped: false, slices: [] };
    expect(savingsNote(spending({ showSavings: false }))).toBeNull();
    expect(savingsNote(spending({ showSavings: true, categories: { ...categories, savings: { cents: 0, accounts: 0 } } }))).toMatch(
      /^No account counts as savings yet/,
    );
    expect(savingsNote(spending({ showSavings: true, categories: { ...categories, savings: { cents: 0, accounts: 2 } } }))).toBe(
      'Nothing moved into savings accounts this month.',
    );
    expect(savingsNote(spending({ showSavings: true, categories: { ...categories, savings: { cents: 25_000, accounts: 1 } } }))).toBe(
      'Savings: $250.00 moved into savings accounts, net of what came back out.',
    );
  });
});
