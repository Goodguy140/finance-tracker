import { describe, expect, it } from 'vitest';

import type { Transaction } from '@/api/types';
import {
  amountDisplay,
  changedFields,
  formFromTransaction,
  groupByDay,
  listPath,
  lockedReason,
  monthRange,
  parseAmountInput,
  parseTagsInput,
  transactionName,
  transactionSubtitle,
  transferChanges,
  transferSides,
} from './transactions';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    type: 'expense',
    date: '2026-11-05',
    postedDate: null,
    title: 'Lunch',
    amountCents: 2_500,
    currency: 'USD',
    categoryId: 'food',
    categoryName: 'Food',
    accountId: 'visa',
    accountName: 'Visa',
    transferAccountId: null,
    note: null,
    tags: ['Work'],
    splits: [],
    owedToYouCents: 0,
    verified: false,
    ...overrides,
  };
}

describe('groupByDay', () => {
  it('keeps the newest-first order and starts a section at each new day', () => {
    const rows = [tx({ id: 'a', date: '2026-11-05' }), tx({ id: 'b', date: '2026-11-05' }), tx({ id: 'c', date: '2026-11-02' })];
    expect(groupByDay(rows).map((s) => [s.day, s.data.map((r) => r.id)])).toEqual([
      ['2026-11-05', ['a', 'b']],
      ['2026-11-02', ['c']],
    ]);
  });
});

describe('monthRange', () => {
  it('ends on the last day, leap years included', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('row text', () => {
  it('names a row by its title, or its category without one', () => {
    expect(transactionName(tx())).toBe('Lunch');
    expect(transactionName(tx({ title: '  ' }))).toBe('Food');
  });

  it('shows spending plain, refunds and income with a plus, transfers without a sign', () => {
    expect(amountDisplay(tx(), 'USD')).toEqual({ text: '$25.00', tone: 'plain' });
    expect(amountDisplay(tx({ amountCents: -1_000 }), 'USD')).toEqual({ text: '+$10.00', tone: 'positive' });
    expect(amountDisplay(tx({ type: 'income', amountCents: 210_000 }), 'USD')).toEqual({ text: '+$2,100.00', tone: 'positive' });
    expect(amountDisplay(tx({ type: 'transfer', amountCents: -50_000 }), 'USD')).toEqual({ text: '$500.00', tone: 'muted' });
  });

  it('says which way a transfer went, and how many categories a split covers', () => {
    const transfer = tx({ type: 'transfer', accountName: 'Chequing', transferAccountName: 'Visa', amountCents: 50_000 });
    expect(transactionSubtitle(transfer)).toBe('Transfer from Chequing to Visa');
    expect(transactionSubtitle({ ...transfer, amountCents: -50_000 })).toBe('Transfer from Visa to Chequing');
    expect(transactionSubtitle(tx({ splits: [{ categoryId: 'a', amountCents: 1 }, { categoryId: 'b', amountCents: 2 }] }))).toBe(
      'Split, 2 categories · Visa',
    );
    expect(transactionSubtitle(tx({ accountName: null }))).toBe('Food');
  });
});

describe('parseAmountInput', () => {
  it('reads amounts as people type them', () => {
    expect(parseAmountInput('12.50')).toBe(1_250);
    expect(parseAmountInput('$1,234.5')).toBe(123_450);
    expect(parseAmountInput('-3')).toBe(-300);
    expect(parseAmountInput('.99')).toBe(99);
  });

  it('refuses what is not an amount, and zero', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('12.345')).toBeNull();
    expect(parseAmountInput('twelve')).toBeNull();
    expect(parseAmountInput('0.00')).toBeNull();
  });
});

describe('parseTagsInput', () => {
  it('splits on commas, trims, and keeps the first spelling of each', () => {
    expect(parseTagsInput('Work, trip ,work,,  Big   trip ')).toEqual(['Work', 'trip', 'Big trip']);
    expect(parseTagsInput('  ')).toEqual([]);
  });
});

describe('changedFields', () => {
  it('sends nothing when nothing changed', () => {
    const row = tx({ note: 'n', postedDate: '2026-11-06' });
    expect(changedFields(row, formFromTransaction(row))).toEqual({ body: {} });
  });

  it('sends only what changed, clearing emptied text and the account', () => {
    const row = tx({ note: 'with Sam' });
    const form = { ...formFromTransaction(row), title: ' Team lunch ', note: '', amount: '31', accountId: null, tags: 'work, Trip' };
    expect(changedFields(row, form)).toEqual({
      body: { title: 'Team lunch', note: null, amountCents: 3_100, accountId: null, tags: ['work', 'Trip'] },
    });
  });

  it('does not resend an amount typed differently but equal, nor tags changed only in case', () => {
    const row = tx();
    expect(changedFields(row, { ...formFromTransaction(row), amount: '25', tags: 'work' })).toEqual({ body: {} });
  });

  it('refuses an amount that is not a number', () => {
    const row = tx();
    expect(changedFields(row, { ...formFromTransaction(row), amount: '2x' })).toEqual({
      error: 'Enter the amount as a number, like 12.50.',
    });
  });
});

describe('a transfer’s accounts', () => {
  const transfer = (overrides: Partial<Transaction> = {}) =>
    tx({ type: 'transfer', accountId: 'chequing', transferAccountId: 'visa', amountCents: 50_000, transferPeerId: null, ...overrides });

  it('reads From and To from the sign: a positive amount left the entry’s own account', () => {
    expect(transferSides(transfer())).toEqual({ from: 'accountId', to: 'transferAccountId' });
    expect(transferSides(transfer({ amountCents: -50_000 }))).toEqual({ from: 'transferAccountId', to: 'accountId' });
  });

  it('sends the side that changed, and both when the transfer is reversed', () => {
    const row = transfer();
    expect(changedFields(row, { ...formFromTransaction(row), transferAccountId: 'savings' })).toEqual({
      body: { transferAccountId: 'savings' },
    });
    expect(changedFields(row, { ...formFromTransaction(row), accountId: 'visa', transferAccountId: 'chequing' })).toEqual({
      body: { accountId: 'visa', transferAccountId: 'chequing' },
    });
    expect(changedFields(row, { ...formFromTransaction(row), transferAccountId: null })).toEqual({ body: { transferAccountId: null } });
  });

  it('refuses one account on both sides, and never sends another side for an expense', () => {
    const row = transfer();
    expect(changedFields(row, { ...formFromTransaction(row), transferAccountId: 'chequing' })).toEqual({
      error: 'Choose two different accounts.',
    });
    const expense = tx();
    expect(changedFields(expense, { ...formFromTransaction(expense), transferAccountId: 'savings' })).toEqual({ body: {} });
  });

  it('can be changed unless the transfer is paired or the server is too old', () => {
    expect(lockedReason(transfer(), 'account')).toBeNull();
    expect(lockedReason(transfer({ transferPeerId: 'other-leg' }), 'account')).toMatch(/Unpair it on the website/);
    expect(lockedReason(transfer({ transferPeerId: 'other-leg' }), 'account', true)).toMatch(/Unpair it below/);
    expect(lockedReason(transfer({ transferPeerId: undefined }), 'account')).toMatch(/too old/);
    expect(lockedReason(transfer(), 'amount')).toMatch(/amount can't be changed/);
  });
});

describe('lockedReason', () => {
  it('locks what the server refuses to change from the phone', () => {
    expect(lockedReason(tx(), 'amount')).toBeNull();
    expect(lockedReason(tx({ splits: [{ categoryId: 'a', amountCents: 1 }] }), 'category')).toMatch(/split/);
    expect(lockedReason(tx({ owedToYouCents: 500 }), 'amount')).toMatch(/owes you/);
    expect(lockedReason(tx({ owedToYouCents: 500 }), 'category')).toBeNull();
    expect(lockedReason(tx({ creditCents: 300 }), 'amount')).toMatch(/credits/);
  });
});

describe('listPath', () => {
  const none = { type: null, needsReview: false };

  it('asks for one month, a page at a time', () => {
    expect(listPath('2026-02', '', none, null)).toBe('/api/v1/transactions?limit=100&from=2026-02-01&to=2026-02-28');
    expect(listPath('2026-02', '', { type: 'income', needsReview: false }, 'c9')).toBe(
      '/api/v1/transactions?limit=100&from=2026-02-01&to=2026-02-28&type=income&cursor=c9',
    );
  });

  it('looks across every month while searching or showing what needs review', () => {
    expect(listPath('2026-02', 'tim hortons', none, null)).toBe('/api/v1/transactions?limit=100&q=tim+hortons');
    expect(listPath('2026-02', '', { type: null, needsReview: true }, null)).toBe('/api/v1/transactions?limit=100&needsReview=true');
  });
});

describe('transferChanges', () => {
  const transfer = (overrides: Partial<Transaction> = {}) =>
    tx({ type: 'transfer', amountCents: 4_000, accountId: 'chequing', transferAccountId: 'savings', transferPeerId: null, ...overrides });
  it('offers Mark as transfer on spending and income, saying what it takes out of', () => {
    expect(transferChanges(tx()).map((c) => [c.change, c.label])).toEqual([['mark', 'Mark as Transfer']]);
    expect(transferChanges(tx())[0].note).toMatch(/totals and budgets/);
    expect(transferChanges(tx({ type: 'income', amountCents: 5_000 }))[0].note).toMatch(/not income/);
  });

  it('counts a transfer back the way the money went', () => {
    expect(transferChanges(transfer({ amountCents: 4_000 })).map((c) => c.label)).toEqual(['Not a Transfer: Count as an Expense']);
    expect(transferChanges(transfer({ amountCents: -4_000 })).map((c) => c.label)).toEqual(['Not a Transfer: Count as Income']);
    expect(transferChanges(transfer())[0].confirm).toBeNull();
  });

  it('asks first for a pair, whose other side changes too', () => {
    const pair = transferChanges(transfer({ transferPeerId: 'other-leg' }));
    expect(pair.map((c) => c.change)).toEqual(['unpair', 'unmark']);
    expect(pair.every((c) => c.confirm)).toBe(true);
  });
});
