import type { SafeToSpend } from '@/api/types';
import { formatCents } from '@/utils/money';

/** The line under the big number, worded as the website's Safe to spend card words it. */
export function safeToSpendLine(data: SafeToSpend, currency: string): string {
  if (data.safeCents < 0) return `Over-committed by ${formatCents(-data.safeCents, currency)} for the rest of the month.`;
  return `About ${formatCents(data.perDayCents, currency)} a day for ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}.`;
}

/** How the number is worked out, row by row, as on the website. */
export function safeToSpendBreakdown(data: SafeToSpend): { label: string; cents: number; sign: '+' | '-' }[] {
  return [
    { label: 'Income received', cents: data.incomeReceivedCents, sign: '+' },
    { label: 'Spent so far', cents: data.spentCents, sign: '-' },
    { label: 'Income still expected', cents: data.expectedIncomeCents, sign: '+' },
    { label: 'Bills still due', cents: data.billsDueCents, sign: '-' },
    { label: 'Left in budgets', cents: data.budgetLeftCents, sign: '-' },
    { label: 'Savings goals this month', cents: data.goalsCents, sign: '-' },
  ];
}
