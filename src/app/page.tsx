import { Suspense } from "react";
import { BillingCycle, CategoryKind, TransactionType } from "@prisma/client";
import Link from "next/link";
import {
  AddFormsDropdown,
  ExpenseForm,
  LogoutButton,
} from "@/components/forms";
import { DashboardMonthFilter } from "@/components/dashboard-month-filter";
import { CategorySpendPieChart } from "@/components/category-spend-pie";
import { ExpenseLogPanel } from "@/components/expense-log";
import { SubscriptionsPanel } from "@/components/subscriptions-panel";
import {
  currentPeriodYm,
  endExclusiveOfMonthYm,
  parseDashboardMonthParam,
  startOfMonthYm,
} from "@/lib/dashboard-period";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { formatCurrency } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const billingCycleLabels: Record<BillingCycle, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

type SearchParams = Promise<{ month?: string | string[] }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const anchorYm = currentPeriodYm(now);
  const period = parseDashboardMonthParam(sp.month, now);
  const isAllMonths = period.kind === "all";
  const selectedYm = period.kind === "month" ? period.ym : anchorYm;
  const budgetAnchorYm = isAllMonths ? anchorYm : selectedYm;

  const expenseDateWhere =
    period.kind === "month"
      ? { date: { gte: startOfMonthYm(period.ym), lt: endExclusiveOfMonthYm(period.ym) } }
      : {};

  const incomeDateWhere =
    period.kind === "month"
      ? { date: { gte: startOfMonthYm(period.ym), lt: endExclusiveOfMonthYm(period.ym) } }
      : {};

  const periodDescription =
    period.kind === "month"
      ? new Date(startOfMonthYm(period.ym)).toLocaleString(undefined, {
          month: "long",
          year: "numeric",
        })
      : "All months (lifetime totals)";

  const [accounts, categories, budgets, subscriptions, periodExpenses, incomeTotal] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: { updatedAt: "desc" } }),
    prisma.subscription.findMany({
      where: { userId: user.id },
      include: { category: true, account: true },
      orderBy: { nextChargeDate: "asc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        ...expenseDateWhere,
      },
      include: { category: true, account: true, splitParts: { include: { category: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...incomeDateWhere,
      },
      _sum: { amountCents: true },
    }),
  ]);

  const expenseCategories = categories.filter((c) => c.kind === CategoryKind.EXPENSE);
  const incomeCategories = categories.filter((c) => c.kind === CategoryKind.INCOME);
  const accountOptions = accounts.map((a) => ({ id: a.id, name: `${a.name} (${a.type})` }));
  const expenseCategoryOptions = expenseCategories.map((c) => ({ id: c.id, name: c.name }));
  const incomeCategoryOptions = incomeCategories.map((c) => ({ id: c.id, name: c.name }));

  const activeBudgetsByCategory = new Map<string, (typeof budgets)[number]>();
  for (const budget of budgets) {
    if (budget.periodMonth > budgetAnchorYm) continue;
    const existing = activeBudgetsByCategory.get(budget.categoryId);
    if (!existing || budget.periodMonth > existing.periodMonth) {
      activeBudgetsByCategory.set(budget.categoryId, budget);
    }
  }
  const totalBudgetCents = Array.from(activeBudgetsByCategory.values()).reduce((sum, budget) => sum + budget.limitCents, 0);
  const spendByCategory = new Map<string, number>();
  for (const expense of periodExpenses) {
    if (expense.splitParts.length > 0) {
      for (const part of expense.splitParts) {
        spendByCategory.set(part.categoryId, (spendByCategory.get(part.categoryId) ?? 0) + part.amountCents);
      }
      continue;
    }
    spendByCategory.set(expense.categoryId, (spendByCategory.get(expense.categoryId) ?? 0) + expense.amountCents);
  }
  const budgetProgressItems = Array.from(activeBudgetsByCategory.values())
    .map((budget) => {
      const spentCents = spendByCategory.get(budget.categoryId) ?? 0;
      const progressPct =
        budget.limitCents > 0
          ? Math.min(Math.max((spentCents / budget.limitCents) * 100, 0), 100)
          : 0;
      return {
        id: budget.id,
        categoryName: budget.category.name,
        spentCents,
        limitCents: budget.limitCents,
        progressPct,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  const currentSpendCents = periodExpenses.reduce((sum, row) => sum + row.amountCents, 0);

  const categoryPieSlices = Array.from(spendByCategory.entries())
    .map(([categoryId, cents]) => {
      const cat = categories.find((c) => c.id === categoryId);
      return { name: cat?.name ?? "Unknown", cents };
    })
    .filter((s) => s.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  const expenseLogEntries = periodExpenses.map((txn) => ({
    id: txn.id,
    amountCents: txn.amountCents,
    dateYmd: ymdFromDateUtc(txn.date),
    dateDisplay: formatDateOnlyUtc(txn.date),
    postedDateYmd: txn.postedDate ? ymdFromDateUtc(txn.postedDate) : null,
    postedDateDisplay: txn.postedDate ? formatDateOnlyUtc(txn.postedDate) : null,
    title: txn.title,
    note: txn.note,
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    accountLabel: txn.account.name,
    categoryLabel: txn.category.name,
    isSplit: txn.splitParts.length > 0,
  }));

  const subscriptionListItems = subscriptions.map((sub) => ({
    id: sub.id,
    name: sub.name,
    amountCents: sub.amountCents,
    accountLabel: `${sub.account.name} (${sub.account.type})`,
    categoryLabel: sub.category.name,
    billingCycleLabel: billingCycleLabels[sub.billingCycle],
    nextChargeDateDisplay: formatDateOnlyUtc(sub.nextChargeDate),
  }));

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="relative z-40 flex flex-col gap-3 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/90 to-slate-900/70 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Finance Tracker</h1>
            <p className="text-sm text-slate-400">Welcome, {user.displayName} ({user.countryCode})</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Suspense
              fallback={
                <span className="text-xs text-slate-500" aria-hidden>
                  Period…
                </span>
              }
            >
              <DashboardMonthFilter anchorYm={anchorYm} />
            </Suspense>
            <AddFormsDropdown
              accounts={accountOptions}
              expenseCategories={expenseCategoryOptions}
              incomeCategories={incomeCategoryOptions}
            />
            <Link href="/settings" className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800">Settings</Link>
            <LogoutButton />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="space-y-4 lg:col-span-7">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4">
              <h2 className="mb-3 text-lg font-semibold">Add Expense</h2>
              <ExpenseForm accounts={accountOptions} expenseCategories={expenseCategoryOptions} />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">Expense Log</h2>
                <p className="text-xs text-slate-400">
                  {periodDescription} · {periodExpenses.length} transaction{periodExpenses.length === 1 ? "" : "s"}
                </p>
              </div>
              <ExpenseLogPanel entries={expenseLogEntries} accounts={accountOptions} categories={expenseCategoryOptions} />
            </div>
          </section>

          <aside className="space-y-4 lg:col-span-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <h2 className="text-lg font-semibold">Income</h2>
              <p className="text-xs text-slate-400">{periodDescription}</p>
              <p className="text-2xl font-bold">{formatCurrency(incomeTotal._sum.amountCents ?? 0)}</p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Budgets</h2>
                <Link
                  href="/settings#budgets"
                  className="text-sm font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline"
                >
                  Manage budgets
                </Link>
              </div>
              {isAllMonths ? (
                <p className="mt-1 text-xs text-slate-400">
                  Spend totals are across all time. Budget limits shown are your active limits as of this month.
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    {isAllMonths ? "Lifetime spend vs budgeted" : "Spend vs budgeted"}
                  </p>
                  <p className="text-base font-semibold">
                    {formatCurrency(currentSpendCents)} / {formatCurrency(totalBudgetCents)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Total budgeted</p>
                  <p className="text-base font-semibold">{formatCurrency(totalBudgetCents)}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Configured budgets</p>
                  <p className="text-base font-semibold">{activeBudgetsByCategory.size}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {budgetProgressItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-200">{item.categoryName}</span>
                      <span className="text-slate-300">
                        {formatCurrency(item.spentCents)} / {formatCurrency(item.limitCents)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${item.progressPct >= 100 ? "bg-red-500" : item.progressPct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                        style={{ width: `${item.progressPct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">Subscriptions</h2>
                <p className="text-xs text-slate-400">
                  {subscriptions.length} subscription{subscriptions.length === 1 ? "" : "s"} · next charge soonest first
                </p>
              </div>
              <SubscriptionsPanel items={subscriptionListItems} />
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <h2 className="text-lg font-semibold">Spending by category</h2>
              <p className="mt-1 text-xs text-slate-400">
                Net expense per category for this period ({periodDescription}). Slice size uses the absolute amount so
                categories with credits stay visible; the tooltip shows the signed total.
              </p>
              <CategorySpendPieChart data={categoryPieSlices} />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
