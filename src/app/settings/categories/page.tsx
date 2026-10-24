import { CategoryKind } from "@prisma/client";
import { CategoriesPanel } from "@/components/categories-panel";
import { BudgetHistory } from "@/components/settings/budget-history";
import { SettingsFold, SettingsPage } from "@/components/settings/ui";
import { buildMonthlyBudgetProgress, selectActiveBudgetsByCategory } from "@/lib/budget-progress";
import { formatCurrency } from "@/lib/money";
import { loadCategorySuggestionContext } from "@/lib/plaid/category-suggestions";
import { buildPlaidMappingView } from "@/lib/plaid/category-mapping-view";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";
import { selectActiveYearlyBudgets } from "@/lib/yearly-budgets";

export const dynamic = "force-dynamic";

export default async function CategoriesSettingsPage() {
  const { user } = await requireLoadedUser();
  const ym = currentYmInTimeZone(user.timezone);
  const [categories, budgets, suggestionContext, transactionCounts, splitCounts, recurringCounts, plaidItemCount, progress, yearly] =
    await Promise.all([
      prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, rolloverSinceMonth: true, groupName: true } }),
      prisma.budget.findMany({
        where: { userId: user.id },
        include: { category: { select: { name: true } } },
        orderBy: [{ periodMonth: "desc" }, { category: { name: "asc" } }],
      }),
      loadCategorySuggestionContext(user.id, user.timezone),
      prisma.transaction.groupBy({ by: ["categoryId"], where: { userId: user.id }, _count: { _all: true } }),
      prisma.splitTransactionPart.groupBy({ by: ["categoryId"], where: { userId: user.id }, _count: { _all: true } }),
      prisma.recurringTransaction.groupBy({ by: ["categoryId"], where: { userId: user.id }, _count: { _all: true } }),
      prisma.plaidItem.count({ where: { userId: user.id } }),
      buildMonthlyBudgetProgress(user.id, ym),
      prisma.yearlyBudget.findMany({ where: { userId: user.id } }),
    ]);

  const countsBy = (rows: { categoryId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.categoryId, row._count._all]));
  const countByCategory = countsBy(transactionCounts);
  const splitsByCategory = countsBy(splitCounts);
  const recurringByCategory = countsBy(recurringCounts);
  const activeBudgets = selectActiveBudgetsByCategory(budgets, ym);
  const activeYearly = selectActiveYearlyBudgets(yearly, Number(ym.slice(0, 4)));
  const activeIds = new Set([...activeBudgets.values()].map((b) => b.id));
  const spentByCategory = new Map(progress.budgets.map((row) => [row.categoryId, row.spentCents]));
  const carryByCategory = new Map(progress.budgets.map((row) => [row.categoryId, row.carryCents]));
  const history = budgets
    .filter((b) => !activeIds.has(b.id))
    .map((b) => ({ id: b.id, categoryName: b.category.name, periodMonth: b.periodMonth, limitCents: b.limitCents }));
  const expenseCategories = categories.filter((c) => c.kind === CategoryKind.EXPENSE);
  const totalBudgetCents = progress.totalLimitCents;

  return (
    <SettingsPage section="categories">
      {totalBudgetCents > 0 ? (
        <p className="text-sm text-slate-400">
          This month: <span className="tabular-nums text-slate-200">{formatCurrency(progress.totalSpentCents)}</span> spent of{" "}
          <span className="tabular-nums text-slate-200">{formatCurrency(totalBudgetCents)}</span> budgeted. Open a category
          to set or change its budget.
        </p>
      ) : (
        <p className="text-sm text-slate-400">Open an expense category to give it a monthly budget.</p>
      )}
      <CategoriesPanel
        categories={categories.flatMap((c) =>
          c.kind === CategoryKind.TRANSFER
            ? []
            : [
                {
                  id: c.id,
                  name: c.name,
                  kind: c.kind,
                  groupName: c.groupName,
                  transactionCount: countByCategory.get(c.id) ?? 0,
                  splitCount: splitsByCategory.get(c.id) ?? 0,
                  recurringCount: recurringByCategory.get(c.id) ?? 0,
                  budgetLimitCents: activeBudgets.get(c.id)?.limitCents ?? null,
                  yearlyLimitCents: activeYearly.get(c.id)?.limitCents ?? null,
                  spentCents: activeBudgets.has(c.id) ? (spentByCategory.get(c.id) ?? 0) : null,
                  rolloverOn: c.rolloverSinceMonth !== null,
                  carryCents: carryByCategory.get(c.id) ?? 0,
                },
              ],
        )}
        plaidGroups={buildPlaidMappingView({
          categories: suggestionContext.categories,
          budgetNames: suggestionContext.budgetNames,
          mappings: suggestionContext.plaidMappings,
        })}
        hasLinkedBank={plaidItemCount > 0}
      />
      <SettingsFold id="budget-history" title="Earlier budgets" meta={history.length > 0 ? `${history.length}` : "None"}>
        <BudgetHistory rows={history} expenseCategories={expenseCategories.map((c) => ({ id: c.id, name: c.name }))} />
      </SettingsFold>
    </SettingsPage>
  );
}
