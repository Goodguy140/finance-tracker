import { describe, expect, it } from 'vitest';

import type { FinancialScore, Insight } from '@/api/types';

import {
  bandTone,
  groupInsights,
  hideOptions,
  hiddenText,
  potentialSavingCents,
  pressingInsights,
  scoreChangeText,
  websiteUrl,
} from './insights';

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    key: 'k',
    section: 'saving',
    severity: 'medium',
    title: 'Netflix went up',
    body: '',
    monthlyCents: null,
    annualCents: null,
    savingCents: null,
    evidence: [],
    website: null,
    ...overrides,
  };
}

type Scored = Extract<FinancialScore, { status: 'scored' }>;

function score(overrides: Partial<Scored> = {}): Scored {
  return {
    status: 'scored',
    currency: 'CAD',
    score: 71,
    band: 'Good',
    months: [],
    change: null,
    pillars: [],
    factors: [],
    suggestions: [],
    omitted: [],
    otherCurrencyAccounts: [],
    emergencyTargetMonths: 3,
    ...overrides,
  };
}

describe('groupInsights', () => {
  it("keeps the website's section order and leaves out empty sections", () => {
    const groups = groupInsights([
      insight({ key: 'a', section: 'good' }),
      insight({ key: 'b', section: 'ahead' }),
      insight({ key: 'c', section: 'good' }),
    ]);
    expect(groups.map((g) => [g.title, g.insights.map((i) => i.key)])).toEqual([
      ['Coming up', ['b']],
      ['Going well', ['a', 'c']],
    ]);
  });
});

describe('potentialSavingCents', () => {
  it('adds up only what the ideas would save', () => {
    expect(potentialSavingCents([insight({ savingCents: 12_000 }), insight({ annualCents: 99_000 }), insight({ savingCents: 3_000 })])).toBe(15_000);
  });
});

describe('hideOptions', () => {
  it("offers the website's buttons for each kind", () => {
    expect(hideOptions(insight({ section: 'recurring' }), 30)).toEqual([{ mode: 'forever', label: 'Not recurring' }]);
    expect(hideOptions(insight({ section: 'habit' }), 30).map((o) => o.label)).toEqual(['Snooze 30 days', "Don't flag this"]);
    expect(hideOptions(insight(), 30).map((o) => o.mode)).toEqual(['snooze', 'forever']);
  });
});

describe('hiddenText', () => {
  it('says until when a snoozed one is hidden', () => {
    expect(hiddenText(insight({ hiddenUntil: '2026-12-03' }))).toMatch(/^Snoozed until .*Dec.*3/);
    expect(hiddenText(insight({ hiddenUntil: null }))).toBe('Dismissed');
  });
});

describe('websiteUrl', () => {
  it('opens a path on the server and nothing else', () => {
    expect(websiteUrl('https://money.example', '/settings/categories')).toBe('https://money.example/settings/categories');
    expect(websiteUrl('https://money.example', '//evil.example/x')).toBeNull();
    expect(websiteUrl('https://money.example', 'https://evil.example')).toBeNull();
    expect(websiteUrl(null, '/insights')).toBeNull();
  });
});

describe('scoreChangeText', () => {
  it("words the month's change as the website does", () => {
    expect(scoreChangeText(score({ change: { fromMonth: '2026-10', fromScore: 68, mover: { label: 'Savings rate', delta: 6 } } }))).toBe(
      'Up 3 since October; savings rate moved most (+6).',
    );
    expect(scoreChangeText(score({ score: 60, change: { fromMonth: '2026-09', fromScore: 64, mover: null } }))).toBe('Down 4 since September.');
    expect(scoreChangeText(score({ change: { fromMonth: '2026-09', fromScore: 71, mover: null } }))).toBe('Same as in September.');
    expect(scoreChangeText(score())).toBeNull();
  });
});

describe('bandTone', () => {
  it('draws good bands green, fair amber and weak red', () => {
    expect(['Strong', 'Good', 'Fair', 'Needs work', 'At risk', null].map((b) => bandTone(b as never))).toEqual([
      'positive',
      'positive',
      'warning',
      'danger',
      'danger',
      'textSecondary',
    ]);
  });
});

describe('pressingInsights', () => {
  it('puts the most severe first across sections, then the bigger amount a year, and keeps a few', () => {
    const list = [
      insight({ key: 'a', section: 'good', severity: 'low' }),
      insight({ key: 'b', section: 'saving', severity: 'medium', annualCents: 1200 }),
      insight({ key: 'c', section: 'gap', severity: 'high' }),
      insight({ key: 'd', section: 'habit', severity: 'medium', annualCents: 9000 }),
    ];
    expect(pressingInsights(list).map((i) => i.key)).toEqual(['c', 'd', 'b']);
    expect(pressingInsights(list, 5).map((i) => i.key)).toEqual(['c', 'd', 'b', 'a']);
    expect(list.map((i) => i.key)).toEqual(['a', 'b', 'c', 'd']);
  });
});
