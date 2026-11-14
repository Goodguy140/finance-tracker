import { describe, expect, it } from 'vitest';

import { hasYearEnd, tagTotalsLine, yearEndPath, yearEndTiles, yearEndTitle, yearInReviewLines } from './year-end';

const report = {
  year: 2025,
  currency: 'USD',
  totals: { incomeCents: 400_000, spendingCents: 300_000, netCents: 100_000, entries: 182 },
  spendingChangePercent: 12,
  biggestMonth: { month: '2025-12', label: 'December 2025', spendingCents: 45_000 },
};

describe('hasYearEnd', () => {
  it('waits for a server that lists the year-end summary', () => {
    expect(hasYearEnd({ features: ['reports', 'year-end'] })).toBe(true);
    expect(hasYearEnd({ features: ['reports'] })).toBe(false);
    expect(hasYearEnd(undefined)).toBe(false);
  });
});

describe('yearEndPath and yearEndTitle', () => {
  it('leaves the year to the server until one is picked, and says so far while it runs', () => {
    expect(yearEndPath(null)).toBe('/api/v1/reports/year');
    expect(yearEndPath('2024')).toBe('/api/v1/reports/year?year=2024');
    expect(yearEndTitle({ year: 2026, toDate: true })).toBe('2026 so far');
    expect(yearEndTitle({ year: 2025, toDate: false })).toBe('2025 in review');
  });
});

describe('yearEndTiles', () => {
  it('shows left over, or overspent as a positive amount', () => {
    expect(yearEndTiles(report)).toEqual([
      { label: 'Income', value: '$4,000.00' },
      { label: 'Spending', value: '$3,000.00' },
      { label: 'Left over', value: '$1,000.00' },
      { label: 'Entries', value: '182' },
    ]);
    const over = yearEndTiles({ ...report, totals: { ...report.totals, netCents: -25_000 } });
    expect(over[2]).toEqual({ label: 'Overspent', value: '$250.00' });
  });
});

describe('yearInReviewLines', () => {
  it('words the change against last year, the biggest month and what was kept, as the website does', () => {
    expect(yearInReviewLines(report)).toEqual([
      'Spending was 12% higher than the same dates in 2024.',
      'Your biggest month was December 2025, at $450.00.',
      'You kept 25% of what came in.',
    ]);
    expect(yearInReviewLines({ ...report, spendingChangePercent: -8 })[0]).toBe('Spending was 8% lower than the same dates in 2024.');
    expect(yearInReviewLines({ ...report, spendingChangePercent: 0 })[0]).toBe('Spending was about the same as the same dates in 2024.');
  });

  it('says nothing it has no figures for, and how much more went out than came in', () => {
    const lines = yearInReviewLines({
      ...report,
      spendingChangePercent: null,
      biggestMonth: null,
      totals: { ...report.totals, netCents: -5_000 },
    });
    expect(lines).toEqual(['You spent $50.00 more than came in.']);
    expect(yearInReviewLines({ ...report, spendingChangePercent: null, biggestMonth: null, totals: { ...report.totals, incomeCents: 0 } })).toEqual([]);
  });
});

describe('tagTotalsLine', () => {
  it('counts entries and leaves out a side with nothing on it', () => {
    const tag = { tagId: 't', name: 'Donation', taxRelated: true, count: 1, spentCents: 5_000, receivedCents: 0 };
    expect(tagTotalsLine(tag, 'USD')).toBe('1 entry · $50.00 spent');
    expect(tagTotalsLine({ ...tag, count: 3, spentCents: 0, receivedCents: 2_000 }, 'USD')).toBe('3 entries · $20.00 received');
    expect(tagTotalsLine({ ...tag, count: 2, receivedCents: 2_000 }, 'USD')).toBe('2 entries · $50.00 spent · $20.00 received');
  });
});
