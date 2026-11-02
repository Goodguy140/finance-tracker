import { describe, expect, it } from 'vitest';

import { barShare, budgetStatus, fundNote, rolloverNote, sectionByGroup } from './budgets';

describe('sectionByGroup', () => {
  const row = (name: string, group: string | null) => ({ name, group });

  it('files rows under their groups alphabetically, matching names ignoring case, the ungrouped last', () => {
    const sections = sectionByGroup(
      [row('Restaurants', 'Food'), row('Gas', null), row('Rent', 'Home'), row('Groceries', 'food')],
      (r) => r.group,
    );
    expect(sections.map((s) => [s.title, s.items.map((r) => r.name)])).toEqual([
      ['Food', ['Restaurants', 'Groceries']],
      ['Home', ['Rent']],
      ['Not grouped', ['Gas']],
    ]);
  });

  it('gives one untitled section when nothing is grouped', () => {
    expect(sectionByGroup([row('Gas', null), row('Fun', '  ')], (r) => r.group)).toEqual([
      { title: null, items: [row('Gas', null), row('Fun', '  ')] },
    ]);
  });
});

describe('budgetStatus', () => {
  it('says what is left, or by how much it is over', () => {
    expect(budgetStatus(28_000, 40_000, 'CAD')).toEqual({ text: 'CA$120.00 left', over: false });
    expect(budgetStatus(40_000, 40_000, 'USD')).toEqual({ text: '$0.00 left', over: false });
    expect(budgetStatus(41_550, 40_000, 'USD')).toEqual({ text: 'Over by $15.50', over: true });
  });
});

describe('rolloverNote', () => {
  it('names a carry in either direction, and nothing without one', () => {
    expect(rolloverNote(2_500, 'USD')).toBe('Includes $25.00 left over from earlier months');
    expect(rolloverNote(-1_000, 'USD')).toBe('Less $10.00 overspent in earlier months');
    expect(rolloverNote(0, 'USD')).toBeNull();
  });
});

describe('fundNote', () => {
  it('describes a fund in hand and one spent ahead', () => {
    expect(fundNote(15_000, 'USD')).toBe('$150.00 in the fund');
    expect(fundNote(0, 'USD')).toBe('$0.00 in the fund');
    expect(fundNote(-5_000, 'USD')).toBe('$50.00 spent ahead of the fund');
  });
});

describe('barShare', () => {
  it('clamps to a full bar and fills a zero limit only when something was spent', () => {
    expect(barShare(5_000, 10_000)).toBe(0.5);
    expect(barShare(15_000, 10_000)).toBe(1);
    expect(barShare(-500, 10_000)).toBe(0);
    expect(barShare(100, 0)).toBe(1);
    expect(barShare(0, 0)).toBe(0);
  });
});
