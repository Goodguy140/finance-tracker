import type { Me, ZeroBased } from '@/api/types';
import { formatCents } from '@/utils/money';

/** The server sends zero-based budgeting's "To assign" and takes the switch from the phone. */
export function canUseZeroBased(me: Me | undefined): boolean {
  return me?.features?.includes('zero-based') ?? false;
}

/** The line under the big number, worded as the website's card words it. */
export function zeroBasedLine(data: ZeroBased, currency: string): string {
  if (data.toAssignCents < 0) {
    return `Assigned ${formatCents(-data.toAssignCents, currency)} more than this month's income. Lower a budget to balance.`;
  }
  if (data.toAssignCents === 0) return 'Every dollar has a job.';
  return 'Give this money a job: raise a budget or a savings goal.';
}

/** Whether the big number reads as a problem (red), settled (plain) or money still free (green). */
export function zeroBasedTone(data: ZeroBased): 'danger' | 'plain' | 'positive' {
  if (data.toAssignCents < 0) return 'danger';
  return data.toAssignCents === 0 ? 'plain' : 'positive';
}

/** The overspent budgets to cover, at most four as on the website, with the line above them; null when none is over. */
export function zeroBasedOverspent(
  data: ZeroBased,
  currency: string,
): { line: string; rows: ZeroBased['overspent'] } | null {
  if (data.overspent.length === 0) return null;
  return {
    line: `${formatCents(data.overspentCents, currency)} overspent to cover. Move money in from another budget.`,
    rows: data.overspent.slice(0, 4),
  };
}

/** How the number is worked out, row by row, as on the website. */
export function zeroBasedBreakdown(data: ZeroBased): { label: string; cents: number; sign: '+' | '-' }[] {
  return [
    { label: 'Income this month', cents: data.incomeCents, sign: '+' },
    { label: 'Assigned to budgets', cents: data.assignedCents, sign: '-' },
    { label: 'Bills outside budgets', cents: data.billsOutsideBudgetsCents, sign: '-' },
    { label: 'Spent outside budgets', cents: data.spentOutsideBudgetsCents, sign: '-' },
    { label: 'Savings goals this month', cents: data.goalsCents, sign: '-' },
  ];
}
