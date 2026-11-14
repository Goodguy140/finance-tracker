import { describe, expect, it } from 'vitest';

import type { DebtStrategy } from '@/api/types';
import { debtFreeText, debtPayoffPath, hasDebtPayoff, isLiabilityType, owedLine, parseRateInput, planNote, rateInputText, rateText, termsLine } from './debt';

describe('hasDebtPayoff and isLiabilityType', () => {
  it('waits for a server with the plan, and counts cards, loans and mortgages as debts', () => {
    expect(hasDebtPayoff({ features: ['year-end', 'debt-payoff'] })).toBe(true);
    expect(hasDebtPayoff({ features: ['year-end'] })).toBe(false);
    expect(['CREDIT_CARD', 'LOAN', 'MORTGAGE', 'CHEQUING', 'PROPERTY'].map(isLiabilityType)).toEqual([true, true, true, false, false]);
  });
});

describe('debtPayoffPath', () => {
  it('asks for the minimums until an amount is typed', () => {
    expect(debtPayoffPath(null)).toBe('/api/v1/debt-payoff');
    expect(debtPayoffPath(50_000)).toBe('/api/v1/debt-payoff?monthlyCents=50000');
  });
});

describe('rates', () => {
  it('reads a yearly percentage as the website does, and shows it back', () => {
    expect(parseRateInput('19.99')).toBe(1_999);
    expect(parseRateInput(' 6% ')).toBe(600);
    expect(parseRateInput('0')).toBe(0);
    expect(parseRateInput('100.01')).toBeNull();
    expect(parseRateInput('19.999')).toBeNull();
    expect(parseRateInput('abc')).toBeNull();
    expect(rateText(1_999)).toBe('19.99%');
    expect(rateText(600)).toBe('6%');
    expect(rateText(1_990)).toBe('19.9%');
    expect(rateInputText(600)).toBe('6.00');
    expect(rateInputText(null)).toBe('');
  });
});

describe('account lines', () => {
  it('says what is owed with the limit used, and which terms are still to set', () => {
    expect(owedLine({ owed: { cents: 100_000, date: '2026-11-13' }, utilization: { pct: 45, high: true } }, 'USD')).toBe(
      '$1,000.00 owed · Nov 13, 2026 · 45% of limit',
    );
    expect(owedLine({ owed: null, utilization: null }, 'USD')).toBeNull();
    expect(termsLine({ interestRateBps: 1_999, minimumPaymentCents: 2_500 }, 'USD')).toBe('19.99% · $25.00 minimum');
    expect(termsLine({ interestRateBps: null, minimumPaymentCents: null }, 'USD')).toBe('No rate yet · no minimum yet');
  });
});

describe('the plan', () => {
  const strategy = (id: DebtStrategy['id'], interest: number, debtFree: string | null): DebtStrategy => ({
    id,
    label: id,
    hint: '',
    months: debtFree ? 12 : null,
    debtFree,
    totalInterestCents: interest,
    payoffOrder: [],
  });
  const plan = {
    currency: 'USD',
    totalOwedCents: 420_000,
    monthlyCents: 30_000,
    strategies: [strategy('avalanche', 40_000, 'March 2028'), strategy('snowball', 45_000, 'April 2028'), strategy('minimums', 90_000, null)],
  };

  it('words the debt-free month and the interest saved against minimums only', () => {
    expect(debtFreeText(plan.strategies[0])).toBe('Debt-free by March 2028');
    expect(debtFreeText(plan.strategies[2])).toBe('Never paid off at this rate');
    expect(planNote(plan, plan.strategies[0])).toBe(
      'Starts from $4,200.00 owed, with interest added monthly at each rate. Paying $300.00 a month, compared with minimums only this saves $500.00 in interest (minimums alone never clear it).',
    );
    expect(planNote(plan, plan.strategies[2])).toContain('this saves $0.00 in interest');
  });
});
