import { describe, expect, it } from 'vitest';

import type { InvestmentActivity, Investments, RoomYear } from '@/api/types';

import {
  canTrackInvestments,
  entryBody,
  entryForm,
  entryPath,
  parseRoomInput,
  pickerAccounts,
  rateText,
  roomLabel,
  roomNote,
  roomValue,
} from './investments';

const room = (over: Partial<RoomYear>): RoomYear => ({
  accountType: 'TFSA',
  year: 2026,
  startingRoomCents: 700_000,
  source: 'entered',
  estimatedFromYear: null,
  contributedCents: 0,
  withdrawnCents: 0,
  remainingCents: 700_000,
  overCents: 0,
  penaltyExcessCents: 0,
  overText: null,
  entries: [],
  ...over,
});

const data: Investments = {
  currency: 'USD',
  today: '2026-11-07',
  accounts: [
    { id: 'chq', name: 'Chequing', type: 'CHEQUING', currency: 'USD', registered: false },
    { id: 'tfsa', name: 'TFSA', type: 'TFSA', currency: 'USD', registered: true },
  ],
  room: [],
  returns: [],
  activity: [],
};

describe('investments', () => {
  it('is offered only by a server that says it takes it', () => {
    expect(canTrackInvestments({ features: ['investments'] } as never)).toBe(true);
    expect(canTrackInvestments({ features: ['goals'] } as never)).toBe(false);
    expect(canTrackInvestments(undefined)).toBe(false);
  });

  it('words returns as Reports does', () => {
    expect(rateText({ rate: 0.0523, annualized: false })).toBe('+5.2%');
    expect(rateText({ rate: -0.01, annualized: true })).toBe('-1.0% a year');
    expect(rateText({ rate: -0.0001, annualized: false })).toBe('0.0%');
    expect(rateText(null)).toBe('—');
  });

  it('says what is left of the room, how much over, or that there is no figure yet', () => {
    expect(roomLabel({ accountType: 'RRSP', year: 2025 })).toBe('RRSP 2025 limit');
    expect(roomValue(room({ remainingCents: 250_000 }), 'USD')).toBe('$2,500.00 left');
    expect(roomValue(room({ remainingCents: -10_000, overCents: 10_000 }), 'USD')).toBe('$100.00 over');
    expect(roomValue(room({ remainingCents: null, source: 'unknown' }), 'USD')).toBe('No 2026 figure yet');
    expect(roomNote(room({ contributedCents: 450_000 }), 'USD')).toBe('$7,000.00 from CRA · $4,500.00 in');
    expect(roomNote(room({ source: 'estimated', estimatedFromYear: 2024 }), 'USD')).toBe(
      'About $7,000.00, estimated from your 2024 figure',
    );
    expect(parseRoomInput('-1,200')).toBe(-120_000);
    expect(parseRoomInput('0')).toBe(0);
    expect(parseRoomInput('lots')).toBeNull();
  });

  it('starts a new entry on an investment account today, and opens an old one as it was', () => {
    expect(pickerAccounts(data.accounts).map((a) => a.id)).toEqual(['tfsa', 'chq']);
    expect(entryForm(undefined, data)).toEqual({ accountId: 'tfsa', direction: 'contribution', amount: '', date: '2026-11-07', note: '' });
    const withdrawal: InvestmentActivity = {
      kind: 'withdrawal',
      id: 'f1',
      accountId: 'tfsa',
      accountName: 'TFSA',
      currency: 'USD',
      amountCents: 12_550,
      date: '2026-03-01',
      note: null,
      fromTransfer: false,
    };
    expect(entryForm(withdrawal, data)).toEqual({ accountId: 'tfsa', direction: 'withdrawal', amount: '125.50', date: '2026-03-01', note: '' });
    expect(entryPath('flow')).toBe('/api/v1/investments/contributions');
    expect(entryPath('value', 'v 1')).toBe('/api/v1/investments/values/v%201');
  });

  it('sends what the server takes, and says what is missing', () => {
    const form = { accountId: 'tfsa', direction: 'contribution' as const, amount: '500', date: '2026-11-07', note: ' Monthly ' };
    expect(entryBody('flow', form)).toEqual({
      body: { accountId: 'tfsa', direction: 'contribution', amountCents: 50_000, date: '2026-11-07', note: 'Monthly' },
    });
    expect(entryBody('value', { ...form, amount: '0', note: '' })).toEqual({
      body: { accountId: 'tfsa', totalValueCents: 0, date: '2026-11-07', note: null },
    });
    expect(entryBody('flow', { ...form, amount: '0' })).toEqual({ error: 'Enter the amount, like 500.' });
    expect(entryBody('flow', { ...form, amount: '-5' })).toEqual({ error: 'Enter the amount, like 500.' });
    expect(entryBody('flow', { ...form, accountId: '' })).toEqual({ error: 'Pick an account.' });
  });
});
