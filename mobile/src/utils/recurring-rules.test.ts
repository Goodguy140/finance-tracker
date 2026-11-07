import { describe, expect, it } from 'vitest';

import type { RecurringRule } from '@/api/types';
import { canEditRules, dayLabel, emptyRuleForm, formFromRule, ruleBody, secondDayOptions } from './recurring-rules';

const netflix: RecurringRule = {
  id: 'r1',
  name: 'Netflix',
  type: 'expense',
  amountCents: 1_699,
  currency: 'USD',
  cadence: 'monthly',
  date: '2026-12-31',
  status: 'upcoming',
  account: 'Chequing',
  toAccount: null,
  category: 'Streaming',
  autoPost: false,
  endDate: null,
  accountId: 'chq',
  transferAccountId: null,
  categoryId: 'stream',
  firstDay: null,
  secondDay: null,
  beforeWeekend: false,
  note: null,
  cancelUrl: 'https://example.test/cancel',
  decideBy: '2026-12-20',
  enabled: true,
  cancelledAt: null,
};

describe('canEditRules', () => {
  it('needs a server that lists paused rules', () => {
    expect(canEditRules({ paused: [] })).toBe(true);
    expect(canEditRules({})).toBe(false);
  });
});

describe('ruleBody', () => {
  it('sends a rule back as it came, with the cancel helper on a bill', () => {
    expect(ruleBody(formFromRule(netflix))).toEqual({
      body: {
        type: 'expense',
        name: 'Netflix',
        amountCents: 1_699,
        accountId: 'chq',
        categoryId: 'stream',
        cadence: 'monthly',
        nextExpectedDate: '2026-12-31',
        endDate: null,
        autoPost: false,
        note: null,
        cancelUrl: 'https://example.test/cancel',
        decideBy: '2026-12-20',
      },
    });
  });

  it('sends a transfer with its other account and no category or cancel fields, and twice-a-month days', () => {
    const form = { ...emptyRuleForm('2026-11-06', 'chq'), type: 'transfer' as const, name: 'Save', amount: '500', transferAccountId: 'sav', cadence: 'semi_monthly' as const, firstDay: 1, secondDay: 15 };
    expect(ruleBody(form)).toEqual({
      body: {
        type: 'transfer',
        name: 'Save',
        amountCents: 50_000,
        accountId: 'chq',
        transferAccountId: 'sav',
        cadence: 'semi_monthly',
        nextExpectedDate: '2026-11-06',
        firstDay: 1,
        secondDay: 15,
        beforeWeekend: false,
        endDate: null,
        autoPost: false,
        note: null,
      },
    });
  });

  it('asks for what is missing, as the website does', () => {
    const form = { ...emptyRuleForm('2026-11-06', 'chq'), name: 'Rent', amount: '1500' };
    expect(ruleBody(form)).toEqual({ error: 'Choose a category.' });
    expect(ruleBody({ ...form, name: 'R' })).toEqual({ error: 'Give the rule a name of at least 2 characters.' });
    expect(ruleBody({ ...form, categoryId: 'housing', ends: true, endDate: '2026-11-01' })).toEqual({
      error: 'End date must be on or after the next expected date.',
    });
    expect(ruleBody({ ...form, type: 'transfer', transferAccountId: 'chq' })).toEqual({ error: 'Choose two different accounts.' });
  });
});

describe('twice-a-month days', () => {
  it('offers second days a week after the first, up to the last day', () => {
    expect(secondDayOptions(15)).toEqual([22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    expect(secondDayOptions(24)).toEqual([31]);
    expect([1, 2, 3, 11, 12, 13, 21, 22, 23, 31].map(dayLabel)).toEqual(['1st', '2nd', '3rd', '11th', '12th', '13th', '21st', '22nd', '23rd', 'Last day']);
  });
});
