import type { RecurringList, RecurringRule } from '@/api/types';
import { CADENCE, RECURRING_PATH } from '@/utils/recurring';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/**
 * The website's Recurring form on the phone: add a rule, change one, pause, cancel or delete it.
 * Days of a twice-a-month rule must be a week apart, the second later in the month.
 */

export const SEMI_MONTHLY_MIN_GAP_DAYS = 7;
export const DEFAULT_SEMI_MONTHLY_DAYS = { firstDay: 15, secondDay: 31 } as const;

export const CADENCE_OPTIONS = (Object.keys(CADENCE) as RecurringRule['cadence'][]).map((value) => ({ value, label: CADENCE[value] }));

/** Rules can be added and changed only on a server that lists the paused ones (newer than build 17). */
export function canEditRules(list: Pick<RecurringList, 'paused'>): boolean {
  return list.paused !== undefined;
}

export function rulePath(id?: string, action?: 'enabled' | 'cancel'): string {
  if (!id) return RECURRING_PATH;
  return `${RECURRING_PATH}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
}

export type RuleForm = {
  type: RecurringRule['type'];
  name: string;
  amount: string;
  accountId: string;
  transferAccountId: string;
  categoryId: string;
  cadence: RecurringRule['cadence'];
  nextDate: string;
  firstDay: number;
  secondDay: number;
  beforeWeekend: boolean;
  ends: boolean;
  endDate: string;
  autoPost: boolean;
  note: string;
  cancelUrl: string;
  decides: boolean;
  decideBy: string;
};

export function emptyRuleForm(today: string, accountId: string): RuleForm {
  return {
    type: 'expense',
    name: '',
    amount: '',
    accountId,
    transferAccountId: '',
    categoryId: '',
    cadence: 'monthly',
    nextDate: today,
    firstDay: DEFAULT_SEMI_MONTHLY_DAYS.firstDay,
    secondDay: DEFAULT_SEMI_MONTHLY_DAYS.secondDay,
    beforeWeekend: false,
    ends: false,
    endDate: today,
    autoPost: false,
    note: '',
    cancelUrl: '',
    decides: false,
    decideBy: today,
  };
}

export function formFromRule(rule: RecurringRule): RuleForm {
  return {
    type: rule.type,
    name: rule.name,
    amount: amountInputText(rule.amountCents),
    accountId: rule.accountId ?? '',
    transferAccountId: rule.transferAccountId ?? '',
    categoryId: rule.categoryId ?? '',
    cadence: rule.cadence,
    nextDate: rule.date,
    firstDay: rule.firstDay ?? DEFAULT_SEMI_MONTHLY_DAYS.firstDay,
    secondDay: rule.secondDay ?? DEFAULT_SEMI_MONTHLY_DAYS.secondDay,
    beforeWeekend: rule.beforeWeekend ?? false,
    ends: rule.endDate !== null,
    endDate: rule.endDate ?? rule.date,
    autoPost: rule.autoPost,
    note: rule.note ?? '',
    cancelUrl: rule.cancelUrl ?? '',
    decides: Boolean(rule.decideBy),
    decideBy: rule.decideBy ?? rule.date,
  };
}

/** The days the second day can be: at least a week after the first, up to 31 (the last day). */
export function secondDayOptions(firstDay: number): number[] {
  return Array.from({ length: 31 - (firstDay + SEMI_MONTHLY_MIN_GAP_DAYS) + 1 }, (_, i) => firstDay + SEMI_MONTHLY_MIN_GAP_DAYS + i);
}

/** "1st" … "30th", and 31 as "Last day", as the website lists them. */
export function dayLabel(day: number): string {
  if (day === 31) return 'Last day';
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/** The body for `POST` / `PATCH /api/v1/recurring`, or what the form still needs. */
export function ruleBody(form: RuleForm): { body: Record<string, unknown> } | { error: string } {
  const name = form.name.trim();
  if (name.length < 2) return { error: 'Give the rule a name of at least 2 characters.' };
  const cents = parseAmountInput(form.amount);
  if (cents === null || cents < 0) return { error: 'Enter the amount each time as a positive number, like 16.99.' };
  if (!form.accountId) return { error: 'Choose an account.' };
  const transfer = form.type === 'transfer';
  if (transfer && !form.transferAccountId) return { error: 'Choose the account the transfer goes to.' };
  if (transfer && form.transferAccountId === form.accountId) return { error: 'Choose two different accounts.' };
  if (!transfer && !form.categoryId) return { error: 'Choose a category.' };
  const semiMonthly = form.cadence === 'semi_monthly';
  if (semiMonthly && form.secondDay - form.firstDay < SEMI_MONTHLY_MIN_GAP_DAYS) {
    return { error: 'Choose two days at least a week apart, the second later in the month.' };
  }
  if (form.ends && form.endDate < form.nextDate) return { error: 'End date must be on or after the next expected date.' };
  const bill = form.type === 'expense';
  return {
    body: {
      type: form.type,
      name,
      amountCents: cents,
      accountId: form.accountId,
      ...(transfer ? { transferAccountId: form.transferAccountId } : { categoryId: form.categoryId }),
      cadence: form.cadence,
      nextExpectedDate: form.nextDate,
      ...(semiMonthly ? { firstDay: form.firstDay, secondDay: form.secondDay, beforeWeekend: form.beforeWeekend } : {}),
      endDate: form.ends ? form.endDate : null,
      autoPost: form.autoPost,
      note: form.note.trim() || null,
      // Only bills carry the cancel helper; the server clears it on the others.
      ...(bill ? { cancelUrl: form.cancelUrl.trim() || null, decideBy: form.decides ? form.decideBy : null } : {}),
    },
  };
}
