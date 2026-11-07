import type { GoalStatus, Me, SavingsGoal } from '@/api/types';
import { formatDate } from '@/utils/dates';
import { formatCents, formatPeriodMonth } from '@/utils/money';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/** Savings goals on the phone: the website's Savings goals card, and Settings → Savings goals' form. */

export const GOALS_PATH = '/api/v1/goals';

export function goalPath(id?: string | null, action?: 'contribute'): string {
  return id ? `${GOALS_PATH}/${encodeURIComponent(id)}${action ? `/${action}` : ''}` : GOALS_PATH;
}

export function canEditGoals(me: Me | undefined): boolean {
  return me?.features?.includes('goals') ?? false;
}

export type Tone = 'positive' | 'tint' | 'warning' | 'danger';

/** The word beside a goal's bar, as the website shows it; none for goals still being judged. */
export const STATUS_LABEL: Partial<Record<GoalStatus, { text: string; tone: Tone }>> = {
  reached: { text: 'Reached', tone: 'positive' },
  'on-track': { text: 'On track', tone: 'tint' },
  behind: { text: 'Behind', tone: 'warning' },
  overdue: { text: 'Past its date', tone: 'danger' },
};

export const BAR_TONE: Record<GoalStatus, Tone | 'muted'> = {
  reached: 'positive',
  'on-track': 'tint',
  open: 'tint',
  needs: 'tint',
  behind: 'warning',
  overdue: 'danger',
  'no-balance': 'muted',
};

/** "Follows Savings · by Jun 1, 2027", "Tracked by hand · no date". */
export function goalSubtitle(goal: SavingsGoal): string {
  const source = goal.account ? `Follows ${goal.account.name}${goal.account.archived ? ' (archived)' : ''}` : 'Tracked by hand';
  return goal.targetDate ? `${source} · by ${formatDate(goal.targetDate)}` : `${source} · no date`;
}

/** The pace the goal is judged by, as a clause; null when there is none. */
function paceClause(goal: SavingsGoal): string | null {
  const money = (cents: number) => formatCents(cents, goal.currency);
  if (goal.paceSource === 'balance' && goal.monthlyPaceCents !== null) {
    return goal.monthlyPaceCents > 0
      ? `the balance has grown about ${money(goal.monthlyPaceCents)} a month lately`
      : "the balance hasn't grown lately";
  }
  if (goal.paceSource === 'transfers' && goal.monthlyTransferCents !== null) {
    return goal.monthlyTransferCents > 0
      ? `you've transferred about ${money(goal.monthlyTransferCents)} a month into it lately`
      : 'more has been transferred out of it than in lately';
  }
  return null;
}

/** One sentence on what the goal needs next, as the website's card says it. */
export function goalAdvice(goal: SavingsGoal): string {
  const money = (cents: number) => formatCents(cents, goal.currency);
  const pace = paceClause(goal);
  const eta = goal.projectedDate
    ? `${goal.paceSource === 'transfers' ? 'At that rate of transfers' : 'At that pace'}, you'd reach it around ${formatPeriodMonth(goal.projectedDate.slice(0, 7))}.`
    : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');
  switch (goal.status) {
    case 'reached':
      return "You've saved the full amount.";
    case 'no-balance':
      return `${goal.account?.name ?? 'The account'} has no balance yet. Record one on its account page.`;
    case 'overdue':
      return join(`${money(goal.remainingCents)} still to go.`, eta);
    case 'open':
      return join(`${money(goal.remainingCents)} to go${pace ? `; ${pace}` : ''}.`, eta);
    case 'needs':
    case 'on-track':
    case 'behind': {
      const needed = `Needs ${money(goal.monthlyNeededCents ?? 0)} a month to make ${goal.targetDate ? formatDate(goal.targetDate) : 'its date'}`;
      return join(pace ? `${needed}; ${pace}.` : `${needed}.`, eta);
    }
  }
}

export type GoalForm = {
  name: string;
  target: string;
  hasDate: boolean;
  date: string;
  /** Empty tracks it by hand. */
  accountId: string;
  /** A hand-tracked goal's saved amount. */
  saved: string;
};

export function emptyGoalForm(today: string): GoalForm {
  // A year out is a goal's usual first guess; the person picks the real one.
  const date = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  return { name: '', target: '', hasDate: false, date, accountId: '', saved: '' };
}

export function formFromGoal(goal: SavingsGoal, today: string): GoalForm {
  return {
    name: goal.name,
    target: amountInputText(goal.targetCents),
    hasDate: goal.targetDate !== null,
    date: goal.targetDate ?? emptyGoalForm(today).date,
    accountId: goal.account?.id ?? '',
    saved: goal.account ? '' : amountInputText(goal.manualSavedCents),
  };
}

/** The body for `POST`/`PATCH /api/v1/goals`, or what is missing, as Settings → Savings goals asks. */
export function goalBody(form: GoalForm): { body: Record<string, unknown> } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Name the goal.' };
  const target = parseAmountInput(form.target);
  if (target === null || target <= 0) return { error: 'Enter the amount to save, like 5000.' };
  let saved: number | undefined;
  if (!form.accountId && form.saved.trim()) {
    const cents = form.saved.trim() === '0' ? 0 : parseAmountInput(form.saved);
    if (cents === null || cents < 0) return { error: 'Enter what is saved so far, or leave it empty.' };
    saved = cents;
  }
  return {
    body: {
      name,
      targetCents: target,
      targetDate: form.hasDate ? form.date : null,
      accountId: form.accountId || null,
      ...(saved !== undefined ? { savedCents: saved } : {}),
    },
  };
}

/** "25", "-10" → cents put in or taken out; null for anything that is not an amount. */
export function parseContribution(raw: string): number | null {
  return parseAmountInput(raw);
}
