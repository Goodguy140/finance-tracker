import { describe, expect, it } from 'vitest';

import type { QuickAddPreview } from '@/api/types';

import { addBody, emptyAddForm, mightBeQuickAdd, quickAddLines, switchAddType, type AddForm } from './add';

const form = (patch: Partial<AddForm>): AddForm => ({ ...emptyAddForm('2026-11-02'), ...patch });

describe('addBody', () => {
  it('sends only what was filled in, leaving category and account to the rules', () => {
    expect(addBody(form({ amount: '12.50', title: '  Lunch ', tags: 'work, Work, team' }))).toEqual({
      body: { type: 'expense', amountCents: 1250, date: '2026-11-02', title: 'Lunch', tags: ['work', 'team'] },
    });
    expect(addBody(form({ type: 'income', amount: '2,000', categoryId: 'c1', accountId: 'a1', note: 'Bonus' }))).toEqual({
      body: { type: 'income', amountCents: 200_000, date: '2026-11-02', note: 'Bonus', categoryId: 'c1', accountId: 'a1' },
    });
  });

  it('takes a negative expense as a refund, but not negative income or transfers', () => {
    expect(addBody(form({ amount: '-5' }))).toMatchObject({ body: { amountCents: -500 } });
    expect(addBody(form({ type: 'income', amount: '-5' }))).toEqual({ error: 'Income is always positive.' });
    expect(addBody(form({ type: 'transfer', amount: '-5', accountId: 'a', transferAccountId: 'b' }))).toHaveProperty('error');
  });

  it('needs an amount, and two different accounts for a transfer, which never sends a category', () => {
    expect(addBody(form({ amount: '' }))).toHaveProperty('error');
    expect(addBody(form({ amount: '0' }))).toHaveProperty('error');
    expect(addBody(form({ type: 'transfer', amount: '50', accountId: 'a' }))).toHaveProperty('error');
    expect(addBody(form({ type: 'transfer', amount: '50', accountId: 'a', transferAccountId: 'a' }))).toEqual({
      error: 'Choose two different accounts.',
    });
    expect(addBody(form({ type: 'transfer', amount: '50', accountId: 'a', transferAccountId: 'b', categoryId: 'c' }))).toEqual({
      body: { type: 'transfer', amountCents: 5000, date: '2026-11-02', accountId: 'a', transferAccountId: 'b' },
    });
  });
});

describe('switchAddType', () => {
  it('keeps what was typed and the account, but drops the category and the other side', () => {
    const typed = form({ amount: '9', title: 'Gift', categoryId: 'food', accountId: 'visa', transferAccountId: 'tfsa' });
    expect(switchAddType(typed, 'income')).toEqual({ ...typed, type: 'income', categoryId: null, transferAccountId: null });
    expect(switchAddType(typed, 'expense')).toBe(typed);
  });
});

describe('mightBeQuickAdd', () => {
  it('asks the server only about text with an amount and a word', () => {
    expect(mightBeQuickAdd('12.50 coffee')).toBe(true);
    expect(mightBeQuickAdd('café 4')).toBe(true);
    expect(mightBeQuickAdd('coffee')).toBe(false);
    expect(mightBeQuickAdd('12.50')).toBe(false);
    expect(mightBeQuickAdd(`1 ${'a'.repeat(200)}`)).toBe(false);
  });
});

describe('quickAddLines', () => {
  const preview: QuickAddPreview = {
    amountCents: 1250,
    title: 'Tim Hortons',
    dateYmd: '2026-11-01',
    categoryName: 'Food',
    accountName: 'Visa',
    split: null,
    transfer: null,
  };

  it('names the amount and title, then the day and where it would be filed', () => {
    expect(quickAddLines(preview, 'CAD', '2026-11-02')).toEqual({ title: `${formatted(1250)} Tim Hortons`, detail: 'Yesterday · Food · Visa' });
    expect(quickAddLines({ ...preview, split: 'Food 60% · Fun 40%', accountName: null }, 'CAD', '2026-11-01').detail).toBe(
      'Today · Food 60% · Fun 40%',
    );
  });

  it('says when a rule would book it as a transfer', () => {
    expect(quickAddLines({ ...preview, transfer: { toAccountName: 'TFSA' } }, 'CAD', '2026-11-01').detail).toBe(
      'Today · Transfer to TFSA from Visa',
    );
    expect(quickAddLines({ ...preview, transfer: { toAccountName: null }, accountName: null }, 'CAD', '2026-11-01').detail).toBe(
      'Today · Transfer',
    );
  });
});

function formatted(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
