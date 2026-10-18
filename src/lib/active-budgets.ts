/**
 * For each category, the most recent budget whose `periodMonth` is on/before `ym`.
 * Budgets carry forward until superseded, matching the dashboard's month view.
 *
 * On its own, free of the database, so pure code (the financial score) can share it.
 */
export function selectActiveBudgetsByCategory<T extends { categoryId: string; periodMonth: string }>(
  budgets: readonly T[],
  ym: string,
): Map<string, T> {
  const active = new Map<string, T>();
  for (const budget of budgets) {
    if (budget.periodMonth > ym) continue;
    const existing = active.get(budget.categoryId);
    if (!existing || budget.periodMonth > existing.periodMonth) {
      active.set(budget.categoryId, budget);
    }
  }
  return active;
}
