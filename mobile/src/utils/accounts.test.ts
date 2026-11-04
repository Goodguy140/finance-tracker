import { describe, expect, it } from 'vitest';

import type { NetWorthAccount } from '@/api/types';

import { accountPath, cardTerms, groupAccounts, registerNote, signedCents } from './accounts';

function account(overrides: Partial<NetWorthAccount> = {}): NetWorthAccount {
  return {
    id: 'a1',
    name: 'Chequing',
    type: 'CHEQUING',
    typeLabel: 'Chequing',
    currency: 'CAD',
    liability: false,
    counted: true,
    balance: null,
    ...overrides,
  };
}

describe('groupAccounts', () => {
  it('splits what you have from what you owe, and lists other currencies apart, keeping the order', () => {
    const groups = groupAccounts([
      account({ id: 'a' }),
      account({ id: 'b', liability: true }),
      account({ id: 'c', counted: false }),
      account({ id: 'd' }),
    ]);
    expect(groups.map((g) => [g.title, g.accounts.map((a) => a.id)])).toEqual([
      ['What you have', ['a', 'd']],
      ['What you owe', ['b']],
      ['Other currencies', ['c']],
    ]);
  });

  it('leaves out a group with no accounts', () => {
    expect(groupAccounts([account()]).map((g) => g.title)).toEqual(['What you have']);
  });
});

describe('signedCents', () => {
  it('marks money in with + and money out with a minus sign', () => {
    expect(signedCents(1_250, 'CAD')).toMatch(/^\+.*12\.50/);
    expect(signedCents(-1_250, 'CAD')).toMatch(/^−.*12\.50/);
  });
});

describe('registerNote', () => {
  it('says what the running balance is worked back from, or how to get one', () => {
    expect(registerNote({ liability: true, balance: { cents: 1, date: '2026-10-31', source: 'bank' } })).toMatch(/^Running amount owed, worked back from the .*Oct.*31/);
    expect(registerNote({ liability: false, balance: null })).toMatch(/^Add a balance/);
  });
});

describe('cardTerms', () => {
  it("words a card's limit, use and due day as the website does", () => {
    expect(cardTerms({ limitCents: 500_000, utilization: { pct: 40, high: true }, highPct: 30, dueDay: 'the 15th' }, 'CAD')).toMatch(
      /^Limit .*5,000\.00, 40% used \(over 30%\)\. Payment due on the 15th of each month\.$/,
    );
    expect(cardTerms({ limitCents: null, utilization: null, highPct: 30, dueDay: 'the last day' }, 'CAD')).toBe(
      'Payment due on the last day of each month.',
    );
  });
});

describe('accountPath', () => {
  it('escapes the id and asks for the register length', () => {
    expect(accountPath('a/b', 12)).toBe('/api/v1/accounts/a%2Fb?months=12');
  });
});
