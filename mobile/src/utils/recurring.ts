import type { RecurringRule } from '@/api/types';
import { dateFromYmd, ymdFromDate } from '@/utils/dates';

export const RECURRING_PATH = '/api/v1/recurring';

const CADENCE: Record<RecurringRule['cadence'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semi_monthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
  biennial: 'Every 2 years',
};

/** "Monthly · Chequing · Housing", or "Monthly · Chequing → Savings" for a transfer. */
export function recurringSubtitle(rule: RecurringRule): string {
  const where = rule.type === 'transfer' && rule.toAccount ? `${rule.account} → ${rule.toAccount}` : rule.account;
  return [CADENCE[rule.cadence] ?? rule.cadence, where, rule.category].filter(Boolean).join(' · ');
}

export type RecurringGroup = { title: string; rules: RecurringRule[] };

/** Overdue, today, the next 7 days, then everything later, each soonest first as the server sends them. */
export function groupRecurring(rules: readonly RecurringRule[], today: string): RecurringGroup[] {
  const end = dateFromYmd(today);
  end.setUTCDate(end.getUTCDate() + 7);
  const weekOut = ymdFromDate(end);
  const groups: RecurringGroup[] = [
    { title: 'Overdue', rules: [] },
    { title: 'Today', rules: [] },
    { title: 'Next 7 days', rules: [] },
    { title: 'Later', rules: [] },
  ];
  for (const rule of rules) {
    const index = rule.status === 'overdue' ? 0 : rule.status === 'due' ? 1 : rule.date <= weekOut ? 2 : 3;
    groups[index].rules.push(rule);
  }
  return groups.filter((group) => group.rules.length > 0);
}

export type RecurringRequest = { path: string; body: Record<string, unknown> };

/** Posts the occurrence the screen showed, so a list gone stale cannot post a different one. */
export function postRequest(rule: Pick<RecurringRule, 'id' | 'date'>): RecurringRequest {
  return { path: `${RECURRING_PATH}/${encodeURIComponent(rule.id)}/post`, body: { expectedDate: rule.date } };
}

export function skipRequest(rule: Pick<RecurringRule, 'id' | 'date'>, reason: 'skip_once' | 'already_logged'): RecurringRequest {
  return { path: `${RECURRING_PATH}/${encodeURIComponent(rule.id)}/skip`, body: { expectedDate: rule.date, reason } };
}
