import type { DebtPayoff, DebtStrategy } from '@/api/types';
import { formatDate } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/** The website's Debt payoff page, on servers that list `debt-payoff` in `/api/v1/me`. */
export function hasDebtPayoff(me: { features?: string[] } | undefined): boolean {
  return me?.features?.includes('debt-payoff') ?? false;
}

/** Credit cards, loans and mortgages: what is owed, which the payoff plan pays down. */
export function isLiabilityType(type: string): boolean {
  return type === 'CREDIT_CARD' || type === 'LOAN' || type === 'MORTGAGE';
}

/** No amount asks for the minimums, as the website does when the field is left alone. */
export function debtPayoffPath(monthlyCents: number | null): string {
  return `/api/v1/debt-payoff${monthlyCents === null ? '' : `?monthlyCents=${monthlyCents}`}`;
}

/** 1999 → "19.99%", 600 → "6%". */
export function rateText(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** The rate field's text: 1999 → "19.99". */
export function rateInputText(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? '' : (bps / 100).toFixed(2);
}

/** "19.99" or "19.99%" → 1999, as the website reads it; null when it is not a yearly rate from 0 to 100. */
export function parseRateInput(raw: string): number | null {
  const s = raw.trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps <= 10_000 ? bps : null;
}

/** "19.99% · $25.00 minimum", or what is still to set. */
export function termsLine(account: Pick<DebtPayoff['accounts'][number], 'interestRateBps' | 'minimumPaymentCents'>, currency: string): string {
  const rate = account.interestRateBps === null ? 'No rate yet' : rateText(account.interestRateBps);
  const minimum = account.minimumPaymentCents === null ? 'no minimum yet' : `${formatCents(account.minimumPaymentCents, currency)} minimum`;
  return `${rate} · ${minimum}`;
}

/** "$1,000.00 owed · Nov 13, 2026 · 45% of limit", or null with no balance to go on. */
export function owedLine(account: Pick<DebtPayoff['accounts'][number], 'owed' | 'utilization'>, currency: string): string | null {
  if (!account.owed) return null;
  const parts = [`${formatCents(account.owed.cents, currency)} owed`, formatDate(account.owed.date)];
  if (account.utilization) parts.push(`${account.utilization.pct}% of limit`);
  return parts.join(' · ');
}

/** "Debt-free by March 2028" or that it never is at this amount. */
export function debtFreeText(strategy: Pick<DebtStrategy, 'debtFree'>): string {
  return strategy.debtFree ? `Debt-free by ${strategy.debtFree}` : 'Never paid off at this rate';
}

/** The website's closing line under the plan: where it starts, and the interest saved against minimums only. */
export function planNote(plan: Pick<DebtPayoff, 'currency' | 'totalOwedCents' | 'monthlyCents' | 'strategies'>, chosen: DebtStrategy): string {
  const money = (cents: number) => formatCents(cents, plan.currency);
  const minimums = plan.strategies.find((s) => s.id === 'minimums');
  const saved = Math.max(0, (minimums?.totalInterestCents ?? 0) - chosen.totalInterestCents);
  return (
    `Starts from ${money(plan.totalOwedCents)} owed, with interest added monthly at each rate. Paying ${money(plan.monthlyCents)} a month, ` +
    `compared with minimums only this saves ${money(saved)} in interest${minimums && minimums.months === null ? ' (minimums alone never clear it)' : ''}.`
  );
}
