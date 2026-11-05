import { describe, expect, it } from 'vitest';

import { systemPathTarget } from './system-path';

describe('systemPathTarget', () => {
  it('leaves the app where it is when a bank sends someone back to Plaid Link', () => {
    const back = 'https://money.example.com/plaid/oauth?oauth_state_id=abc-123';
    expect(systemPathTarget(back, false)).toBe('');
    expect(systemPathTarget(back, true)).toBe('/');
  });

  it('sends shares to the receipt screen and every other link where it says', () => {
    expect(systemPathTarget('financetracker://expo-sharing?dataUrl=x', false)).toBe('/share');
    expect(systemPathTarget('financetracker://bills', false)).toBe('financetracker://bills');
    expect(systemPathTarget('/budgets', true)).toBe('/budgets');
    expect(systemPathTarget('https://money.example.com/plaid/oauth/other', false)).toBe(
      'https://money.example.com/plaid/oauth/other',
    );
  });
});
