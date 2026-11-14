import { describe, expect, it } from 'vitest';

import type { RecurringPrefill, RecurringRule } from '@/api/types';
import { canEditRules, dayLabel, emptyRuleForm, formFromPrefill, formFromRule, parsePrefillParam, ruleBody, secondDayOptions } from './recurring-rules';

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

describe('formFromPrefill', () => {
  const pay: RecurringPrefill = {
    name: 'Pay',
    type: 'income',
    amountCents: 210_000,
    cadence: 'semi_monthly',
    accountId: 'chq',
    categoryId: 'salary',
    nextExpectedDate: '2026-11-28',
    semiMonthly: { firstDay: 14, secondDay: 30, beforeWeekend: true },
  };
  const accounts = [
    { id: 'old', archived: true },
    { id: 'chq', archived: false },
  ];
  const categories = [{ id: 'salary', kind: 'income' as const }];

  it('opens the rule form as Insights noticed it, and saves as the website form would', () => {
    const form = formFromPrefill(pay, '2026-11-14', accounts, categories);
    expect(form).toMatchObject({ type: 'income', name: 'Pay', amount: '2100.00', accountId: 'chq', categoryId: 'salary', cadence: 'semi_monthly', nextDate: '2026-11-28', firstDay: 14, secondDay: 30, beforeWeekend: true });
    expect(ruleBody(form)).toMatchObject({ body: { type: 'income', name: 'Pay', amountCents: 210_000, categoryId: 'salary', accountId: 'chq' } });
  });

  it('falls back to an open account, leaves a vanished category to pick, and never starts in the past', () => {
    const form = formFromPrefill({ ...pay, accountId: 'old', categoryId: 'gone', nextExpectedDate: '2026-11-01' }, '2026-11-14', accounts, categories);
    expect([form.accountId, form.categoryId, form.nextDate]).toEqual(['chq', '', '2026-11-14']);
  });
});

describe('parsePrefillParam', () => {
  it('reads back what Insights passed, and ignores anything else', () => {
    const prefill: RecurringPrefill = { name: 'Gym', type: 'expense', amountCents: 4_000, cadence: 'monthly', accountId: null, categoryId: 'c', nextExpectedDate: '2026-12-01', semiMonthly: null };
    expect(parsePrefillParam(JSON.stringify(prefill))).toEqual(prefill);
    expect(parsePrefillParam(undefined)).toBeNull();
    expect(parsePrefillParam('{not json')).toBeNull();
    expect(parsePrefillParam(JSON.stringify({ ...prefill, cadence: 'hourly' }))).toBeNull();
  });
});
