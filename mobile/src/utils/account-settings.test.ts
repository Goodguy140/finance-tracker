import { describe, expect, it } from 'vitest';

import type { AccountPage } from '@/api/types';

import { accountForm, accountPatch, canEditAccounts, emptyAccountForm, newAccountBody } from './account-settings';

const page = (over: Partial<AccountPage['account']> = {}, settings: AccountPage['settings'] = { countsAsSavings: false, creditLimitCents: 500_000, paymentDueDay: 15 }) =>
  ({
    account: { id: 'a1', name: 'Visa', type: 'CREDIT_CARD', typeLabel: 'Credit card', currency: 'USD', archived: false, ...over },
    settings,
  }) as AccountPage;

describe('account settings', () => {
  it('is offered only by a server that says it takes it', () => {
    expect(canEditAccounts({ features: ['account-settings'] } as never)).toBe(true);
    expect(canEditAccounts({ features: [] } as never)).toBe(false);
    expect(canEditAccounts(undefined)).toBe(false);
  });

  it('adds an account by name and type, as the website does', () => {
    expect(newAccountBody({ ...emptyAccountForm('USD'), name: '  Joint chequing ' })).toEqual({ body: { name: 'Joint chequing', type: 'CHEQUING' } });
    expect(newAccountBody(emptyAccountForm('USD'))).toEqual({ error: 'Name the account, in 2 to 80 characters.' });
  });

  it("opens an account's settings as they are, and sends only what changed", () => {
    const form = accountForm(page());
    expect(form).toEqual({ name: 'Visa', type: 'CREDIT_CARD', currency: 'USD', countsAsSavings: false, creditLimit: '5000.00', dueDay: '15' });
    expect(accountPatch(form, page())).toBeNull();
    expect(accountPatch({ ...form, name: 'Visa Infinite', dueDay: '21' }, page())).toEqual({ body: { name: 'Visa Infinite', paymentDueDay: 21 } });
    // Emptying the limit clears it.
    expect(accountPatch({ ...form, creditLimit: '' }, page())).toEqual({ body: { creditLimitCents: null } });
    expect(accountPatch({ ...form, currency: 'cad' }, page())).toEqual({ body: { currency: 'CAD' } });
  });

  it('leaves card details out for other types, and says what is wrong', () => {
    const chequing = page({ type: 'CHEQUING', name: 'Chequing' }, { countsAsSavings: false, creditLimitCents: null, paymentDueDay: null });
    const form = accountForm(chequing);
    expect(accountPatch({ ...form, countsAsSavings: true, creditLimit: '100' }, chequing)).toEqual({ body: { countsAsSavings: true } });
    const card = accountForm(page());
    expect(accountPatch({ ...card, dueDay: '32' }, page())).toEqual({ error: 'Enter the due day as a day of the month, 1 to 31.' });
    expect(accountPatch({ ...card, dueDay: '1st' }, page())).toEqual({ error: 'Enter the due day as a day of the month, 1 to 31.' });
    expect(accountPatch({ ...card, creditLimit: '-5' }, page())).toEqual({ error: 'Enter the credit limit as an amount, like 5000.' });
    expect(accountPatch({ ...card, currency: 'CA' }, page())).toEqual({ error: 'A currency is a 3-letter code, like CAD.' });
  });
});
