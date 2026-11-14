import { describe, expect, it } from 'vitest';

import type { Me } from '@/api/types';
import { canPickPeriod, initialRange, isRange, periodQuery, storedPeriod } from '@/utils/period';

describe('periodQuery', () => {
  it('asks for a month, year to date through a month, or a custom range of days', () => {
    expect(periodQuery({ kind: 'month' })).toEqual([]);
    expect(periodQuery({ kind: 'month' }, '2026-03')).toEqual(['month=2026-03']);
    expect(periodQuery({ kind: 'ytd' })).toEqual(['range=ytd']);
    expect(periodQuery({ kind: 'ytd' }, '2025-08')).toEqual(['range=ytd', 'month=2025-08']);
    expect(periodQuery({ kind: 'custom', from: '2025-12-30', to: '2026-01-15' }, '2026-03')).toEqual([
      'range=custom',
      'from=2025-12-30',
      'to=2026-01-15',
    ]);
  });
});

describe('the rest', () => {
  it('needs a server with periods, tells a range from a month, and starts a picker from the year so far', () => {
    expect(canPickPeriod({ features: ['periods'] } as Me)).toBe(true);
    expect(canPickPeriod({ features: [] } as unknown as Me)).toBe(false);
    expect(isRange(undefined)).toBe(false);
    expect(isRange({ range: 'month', from: '2026-03-01', to: '2026-03-31', label: 'March 2026' })).toBe(false);
    expect(isRange({ range: 'ytd', from: '2026-01-01', to: '2026-03-31', label: 'Year to date' })).toBe(true);
    expect(initialRange({ kind: 'ytd' }, '2026-03-25')).toEqual({ from: '2026-01-01', to: '2026-03-25' });
    expect(initialRange({ kind: 'custom', from: '2026-02-01', to: '2026-02-10' }, '2026-03-25')).toEqual({ from: '2026-02-01', to: '2026-02-10' });
  });

  it('reads back only a choice it could have stored', () => {
    expect(storedPeriod({ kind: 'ytd' })).toEqual({ kind: 'ytd' });
    expect(storedPeriod({ kind: 'custom', from: '2026-01-01', to: '2026-02-01' })).toEqual({ kind: 'custom', from: '2026-01-01', to: '2026-02-01' });
    for (const bad of [null, 'ytd', { kind: 'week' }, { kind: 'custom', from: '2026-02-01', to: '2026-01-01' }, { kind: 'custom', from: 'soon' }]) {
      expect(storedPeriod(bad)).toBeUndefined();
    }
  });
});
