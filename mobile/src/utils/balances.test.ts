import { describe, expect, it } from 'vitest';

import { balanceBody, balancesPath, canRecordBalance, parseBalanceInput } from './balances';

describe('parseBalanceInput', () => {
  it('reads zero and overdrawn balances, which an entry amount would refuse', () => {
    expect(parseBalanceInput('0')).toBe(0);
    expect(parseBalanceInput('-0')).toBe(0);
    expect(parseBalanceInput('$-20')).toBe(-2000);
    expect(parseBalanceInput('1,234.5')).toBe(123450);
    expect(parseBalanceInput('12.345')).toBeNull();
    expect(parseBalanceInput('')).toBeNull();
  });
});

describe('balanceBody', () => {
  it('sends cents and the day, and refuses a day after today', () => {
    expect(balanceBody('100', '2026-11-06', '2026-11-06')).toEqual({ body: { balanceCents: 10000, date: '2026-11-06' } });
    expect(balanceBody('100', '2026-11-07', '2026-11-06')).toEqual({ error: "A balance can't be dated after today." });
    expect(balanceBody('lots', '2026-11-06', '2026-11-06')).toHaveProperty('error');
  });
});

describe('canRecordBalance', () => {
  const account = { id: 'a1', name: 'Cash', type: 'CASH', typeLabel: 'Cash', currency: 'CAD', archived: false };
  it('needs an open account on a server that lists hand-entered balances', () => {
    expect(canRecordBalance({ account, manualBalances: [] })).toBe(true);
    expect(canRecordBalance({ account, manualBalances: undefined })).toBe(false);
    expect(canRecordBalance({ account: { ...account, archived: true }, manualBalances: [] })).toBe(false);
  });
});

describe('balancesPath', () => {
  it('escapes ids', () => {
    expect(balancesPath('a/1')).toBe('/api/v1/accounts/a%2F1/balances');
    expect(balancesPath('a1', 'b 2')).toBe('/api/v1/accounts/a1/balances/b%202');
  });
});
