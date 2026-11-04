import { describe, expect, it } from 'vitest';

import { latestSiriPrefill, LOG_EXPENSE, SIRI_FRESH_MS, siriPrefill } from '@/utils/siri';

const NOW = 1_800_000_000_000;

describe('siriPrefill', () => {
  it('writes the amount Siri heard as the Add sheet types it, with what it was for', () => {
    expect(siriPrefill({ amount: 12.5, title: '  Coffee ' }, NOW - 1000, NOW)).toEqual({ amount: '12.50', title: 'Coffee' });
    expect(siriPrefill({ amount: 3.999 }, NOW, NOW)).toEqual({ amount: '4.00', title: null });
  });

  it('opens nothing for an amount that is missing, zero, negative or absurd', () => {
    for (const amount of [undefined, 0, -5, Number.NaN, Infinity, 1e12, '12']) {
      expect(siriPrefill({ amount }, NOW, NOW)).toBeNull();
    }
  });

  it('lets an invocation go once it has waited too long', () => {
    expect(siriPrefill({ amount: 5 }, NOW - SIRI_FRESH_MS, NOW)).not.toBeNull();
    expect(siriPrefill({ amount: 5 }, NOW - SIRI_FRESH_MS - 1, NOW)).toBeNull();
  });
});

describe('latestSiriPrefill', () => {
  it('opens only the newest usable Log an expense', () => {
    const invocations = [
      { name: LOG_EXPENSE, params: { amount: 9 }, createdAt: NOW - 3000 },
      { name: LOG_EXPENSE, params: { amount: 20 }, createdAt: NOW - 1000 },
      { name: LOG_EXPENSE, params: { amount: -1 }, createdAt: NOW },
      { name: 'somethingElse', params: { amount: 7 }, createdAt: NOW },
    ];
    expect(latestSiriPrefill(invocations, NOW)).toEqual({ amount: '20.00', title: null });
    expect(latestSiriPrefill([], NOW)).toBeNull();
  });
});
