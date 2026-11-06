import type { Plan } from '@/api/types';
import { parseAmountInput } from '@/utils/transactions';

export const PLANS_PATH = '/api/v1/planned';

export function planPath(id: string, action?: 'record'): string {
  return `${PLANS_PATH}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
}

export type PlanForm = {
  type: 'expense' | 'income';
  name: string;
  amount: string;
  date: string;
  accountId: string;
  categoryId: string;
  note: string;
};

export function emptyPlanForm(date: string, accountId: string): PlanForm {
  return { type: 'expense', name: '', amount: '', date, accountId, categoryId: '', note: '' };
}

export function formFromPlan(plan: Plan): PlanForm {
  return {
    type: plan.type,
    name: plan.name,
    amount: (plan.amountCents / 100).toFixed(2),
    date: plan.date,
    accountId: plan.accountId,
    categoryId: plan.categoryId,
    note: plan.note ?? '',
  };
}

/** The body for `POST`/`PATCH /api/v1/planned`, or what is missing, as the website's Plan form asks. */
export function planBody(form: PlanForm): { body: Record<string, unknown> } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Name what you are planning for.' };
  const cents = parseAmountInput(form.amount);
  if (cents === null || cents < 0) return { error: 'Enter a positive amount, like 600.' };
  if (!form.accountId) return { error: 'Choose an account.' };
  if (!form.categoryId) return { error: 'Choose a category.' };
  return {
    body: {
      type: form.type,
      name,
      amountCents: cents,
      date: form.date,
      accountId: form.accountId,
      categoryId: form.categoryId,
      note: form.note.trim() || null,
    },
  };
}

/** Plans whose date has passed (asking "Did this happen?"), then those still to come. */
export function groupPlans(plans: readonly Plan[]): { title: string; plans: Plan[] }[] {
  return [
    { title: 'Did this happen?', plans: plans.filter((p) => p.pastDue) },
    { title: 'One-off plans', plans: plans.filter((p) => !p.pastDue) },
  ].filter((group) => group.plans.length > 0);
}
