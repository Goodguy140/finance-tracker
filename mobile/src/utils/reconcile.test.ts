import { describe, expect, it } from 'vitest';

import { balanceLabels, balanceText, canReconcile, checkedStatement, checkLines, inOutText, reconcilePath } from './reconcile';

describe('canReconcile and reconcilePath', () => {
  it('waits for a server that reconciles, and asks with the statement in cents', () => {
    expect(canReconcile({ features: ['reconcile'] })).toBe(true);
    expect(canReconcile({ features: [] })).toBe(false);
    expect(reconcilePath('a1')).toBe('/api/v1/accounts/a1/reconcile');
    expect(reconcilePath('a1', { from: '2026-09-01', to: '2026-09-30', openingCents: -500, closingCents: 130_000 })).toBe(
      '/api/v1/accounts/a1/reconcile?from=2026-09-01&to=2026-09-30&openingCents=-500&closingCents=130000',
    );
  });
});

describe('checkedStatement', () => {
  it('takes zero and overdrawn balances, and refuses backwards dates or a missing balance', () => {
    expect(checkedStatement({ from: '2026-09-01', to: '2026-09-30', opening: '0', closing: '-12.50' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      openingCents: 0,
      closingCents: -1_250,
    });
    expect(checkedStatement({ from: '2026-09-30', to: '2026-09-01', opening: '0', closing: '0' })).toEqual({ error: 'The statement has to end after it starts.' });
    expect(checkedStatement({ from: '2026-09-01', to: '2026-09-30', opening: '100', closing: '' })).toEqual({
      error: 'Enter both balances from the statement, like 1234.56.',
    });
    expect(balanceText(130_000)).toBe('1300.00');
    expect(balanceText(null)).toBe('');
  });
});

describe('the result', () => {
  const check = { moneyInCents: 0, moneyOutCents: 0, expectedClosingCents: 0, differenceCents: 0, statementShows: null, waitingInQueue: 0, rows: [] };

  it('says it matches, or how far off which way, with the bank rows still waiting', () => {
    expect(checkLines(check, 'USD')).toEqual({ matches: true, headline: 'It matches. Every entry for these dates agrees with the statement.', hint: null });
    const off = checkLines({ ...check, differenceCents: -1_000, statementShows: 'less', waitingInQueue: 2 }, 'USD');
    expect(off.matches).toBe(false);
    expect(off.headline).toBe('Off by $10.00: the statement shows less money in the account than the log does.');
    expect(off.hint).toContain('2 bank transactions for this account and these dates are still waiting in your review queue.');
    expect(checkLines({ ...check, differenceCents: 500, statementShows: 'more' }, 'USD').hint).toBe(
      'Look for an entry that is missing, logged twice, on another account, or dated outside these days.',
    );
  });

  it('labels a card or loan as what is owed, and signs money in and out', () => {
    expect(balanceLabels(true)).toEqual({ opening: 'Owed at the start', closing: 'Owed at the end', running: 'Owed' });
    expect(balanceLabels(false).opening).toBe('Opening balance');
    expect(inOutText(100_000, 'USD')).toBe('+$1,000.00');
    expect(inOutText(-20_000, 'USD')).toBe('−$200.00');
  });
});
