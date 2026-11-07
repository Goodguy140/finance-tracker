import { describe, expect, it } from 'vitest';

import { canSetAlertTiming, chargeAmountChange, chargeAmountText, reminderChoices, reminderNote } from './alert-timing';

describe('alert timing', () => {
  it('is offered only by a server that says it takes it', () => {
    const me = (features?: string[]) => ({ features }) as Parameters<typeof canSetAlertTiming>[0];
    expect(canSetAlertTiming(me(['alert-timing']))).toBe(true);
    expect(canSetAlertTiming(me(['rules']))).toBe(false);
    expect(canSetAlertTiming(me(undefined))).toBe(false);
  });

  it('offers off first, then each lead time the server takes', () => {
    expect(reminderChoices({ billReminderOptions: [1, 3, 7] })).toEqual([
      { days: null, label: 'Off' },
      { days: 1, label: 'Day before' },
      { days: 3, label: '3 days' },
      { days: 7, label: 'A week' },
    ]);
    expect(reminderNote(3)).toMatch(/^A reminder 3 days before each recurring bill/);
    expect(reminderNote(null)).toBe('No reminders before bills are due.');
  });

  it('saves the large-charge amount only when the field says something new', () => {
    expect(chargeAmountText(25_000)).toBe('250.00');
    expect(chargeAmountText(null)).toBe('');
    // The same amount, however it is typed, is no change.
    expect(chargeAmountChange('250', 25_000)).toBeNull();
    expect(chargeAmountChange('$1,000.5', 25_000)).toEqual({ cents: 100_050 });
    // Emptying the field turns the check off, unless it already is.
    expect(chargeAmountChange('  ', 25_000)).toEqual({ cents: null });
    expect(chargeAmountChange('', null)).toBeNull();
    expect(chargeAmountChange('0', null)).toEqual({ error: expect.stringContaining('above zero') });
    expect(chargeAmountChange('-5', null)).toEqual({ error: expect.stringContaining('above zero') });
    expect(chargeAmountChange('lots', null)).toEqual({ error: expect.stringContaining('above zero') });
  });
});
