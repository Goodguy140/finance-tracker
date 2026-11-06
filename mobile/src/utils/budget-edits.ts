import type { BudgetRow, Budgets } from '@/api/types';
import { formatCents } from '@/utils/money';
import { amountInputText, parseAmountInput } from '@/utils/transactions';

/**
 * Changing budgets from the phone, as the website's Settings → Categories and the Budgets card's
 * "Cover overage" do: a monthly budget from this month on, rollover, a yearly budget from this
 * year on, and an overage covered from other budgets' room this month.
 */

export function budgetPath(categoryId: string, action?: 'cover'): string {
  return `/api/v1/budgets/${encodeURIComponent(categoryId)}${action ? `/${action}` : ''}`;
}

/**
 * Budgets can be changed only on this month's page, and only from a server that says which month
 * that is (one from before sends no `currentMonth` and takes no changes).
 */
export function canEditBudgets(data: Pick<Budgets, 'periodMonth' | 'currentMonth'>): boolean {
  return data.currentMonth !== undefined && data.periodMonth === data.currentMonth;
}

export type BudgetForm = { monthly: string; rollover: boolean; yearly: string };

/** The category's budgets as they stand this month, as the sheet starts. */
export function budgetFormFor(data: Budgets, categoryId: string): BudgetForm {
  const row = data.budgets.find((b) => b.categoryId === categoryId);
  const yearly = data.yearly?.find((y) => y.categoryId === categoryId);
  return {
    monthly: row ? amountInputText(row.monthlyLimitCents) : '',
    rollover: row?.rollover ?? false,
    yearly: yearly ? amountInputText(yearly.limitCents) : '',
  };
}

function parseLimit(raw: string, period: 'monthly' | 'yearly'): number | null | { error: string } {
  if (!raw.trim()) return null;
  const cents = parseAmountInput(raw);
  if (cents === null || cents < 0) return { error: `Enter a ${period} budget above zero, like 400.` };
  return cents;
}

export type BudgetPatch = { monthlyCents?: number | null; rollover?: boolean; yearlyCents?: number | null };

/**
 * What changed, for `PATCH /api/v1/budgets/:id`. An emptied field removes that budget; rollover
 * goes with the monthly budget, so it is not sent once that is removed.
 */
export function budgetPatch(initial: BudgetForm, form: BudgetForm): { body: BudgetPatch; removesMonthly: boolean } | { error: string } {
  const before = { monthly: parseLimit(initial.monthly, 'monthly'), yearly: parseLimit(initial.yearly, 'yearly') };
  const monthly = parseLimit(form.monthly, 'monthly');
  if (monthly !== null && typeof monthly === 'object') return monthly;
  const yearly = parseLimit(form.yearly, 'yearly');
  if (yearly !== null && typeof yearly === 'object') return yearly;

  const body: BudgetPatch = {};
  if (monthly !== before.monthly) body.monthlyCents = monthly;
  if (monthly !== null && form.rollover !== initial.rollover) body.rollover = form.rollover;
  if (yearly !== before.yearly) body.yearlyCents = yearly;
  return { body, removesMonthly: before.monthly !== null && monthly === null };
}

/** How far a budget is over this month (0 when it is not). */
export function overageCents(row: Pick<BudgetRow, 'spentCents' | 'limitCents'>): number {
  return Math.max(0, row.spentCents - row.limitCents);
}

/** What a budget has left to give this month (0 when nothing). */
export function roomCents(row: Pick<BudgetRow, 'spentCents' | 'limitCents'>): number {
  return Math.max(0, row.limitCents - row.spentCents);
}

/** The other budgets with room to give, by name, as the website's dialog lists them. */
export function coverSources(data: Budgets, categoryId: string): BudgetRow[] {
  return data.budgets
    .filter((row) => row.categoryId !== categoryId && roomCents(row) > 0)
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/** The amounts the website fills in: the overage, taken from the roomiest budgets first. */
export function coverPrefill(overage: number, sources: readonly BudgetRow[]): Record<string, string> {
  const amounts: Record<string, string> = {};
  let remaining = overage;
  for (const source of [...sources].sort((a, b) => roomCents(b) - roomCents(a))) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, roomCents(source));
    amounts[source.categoryId] = amountInputText(take);
    remaining -= take;
  }
  return amounts;
}

export type CoverPlan = {
  from: { categoryId: string; amountCents: number }[];
  allocatedCents: number;
  /** Still to cover; negative when more is taken than the overage. */
  remainingCents: number;
  error: string | null;
};

/** What the typed amounts add up to, and what stops them being saved. */
export function coverPlan(overage: number, sources: readonly BudgetRow[], amounts: Record<string, string>, currency: string): CoverPlan {
  const from: CoverPlan['from'] = [];
  let error: string | null = null;
  for (const source of sources) {
    const raw = amounts[source.categoryId] ?? '';
    if (!raw.trim()) continue;
    const cents = parseAmountInput(raw);
    if (cents === null || cents < 0) {
      error ??= `Type ${source.categoryName}'s amount as a number, like 25.`;
      continue;
    }
    if (cents > roomCents(source)) error ??= `${source.categoryName} has only ${formatCents(roomCents(source), currency)} to give.`;
    from.push({ categoryId: source.categoryId, amountCents: cents });
  }
  const allocatedCents = from.reduce((sum, f) => sum + f.amountCents, 0);
  const remainingCents = overage - allocatedCents;
  if (!error && remainingCents < 0) error = `That is ${formatCents(-remainingCents, currency)} more than the overage.`;
  if (!error && allocatedCents === 0) error = 'Take something from at least one budget.';
  return { from, allocatedCents, remainingCents, error };
}
