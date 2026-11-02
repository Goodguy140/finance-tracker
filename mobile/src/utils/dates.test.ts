import { describe, expect, it } from 'vitest';

import { formatDay, relativeDay, shiftMonth } from './dates';

describe('formatDay', () => {
  it('writes the calendar day the server meant, whatever the phone’s time zone', () => {
    expect(formatDay('2026-11-05', 'en-US')).toBe('Thu, Nov 5');
    expect(formatDay('2026-01-01', 'en-US')).toBe('Thu, Jan 1');
  });

  it('passes through anything that is not a day', () => {
    expect(formatDay('soon', 'en-US')).toBe('soon');
  });
});

describe('relativeDay', () => {
  it('names today, tomorrow and yesterday, across a month end', () => {
    expect(relativeDay('2026-11-30', '2026-11-30', 'en-US')).toBe('Today');
    expect(relativeDay('2026-12-01', '2026-11-30', 'en-US')).toBe('Tomorrow');
    expect(relativeDay('2026-11-29', '2026-11-30', 'en-US')).toBe('Yesterday');
    expect(relativeDay('2026-12-03', '2026-11-30', 'en-US')).toBe('Thu, Dec 3');
  });
});

describe('shiftMonth', () => {
  it('moves across year ends both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-06', -18)).toBe('2024-12');
    expect(shiftMonth('2026-06', 0)).toBe('2026-06');
  });
});
