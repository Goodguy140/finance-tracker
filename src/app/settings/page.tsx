import { CategoryKind } from "@prisma/client";
import Link from "next/link";
import { SettingsForms } from "@/components/forms";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const [accounts, categories, budgets] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: [{ periodMonth: "desc" }, { category: { name: "asc" } }] }),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived);
  const accountOptions = activeAccounts.map((account) => ({ id: account.id, name: account.name }));
  const accountItems = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    archived: account.archived,
    currency: account.currency,
  }));
  const expenseCategoryOptions = categories.map((category) => ({ id: category.id, name: category.name }));
  const budgetItems = budgets.map((budget) => ({
    id: budget.id,
    periodMonth: budget.periodMonth,
    name: budget.name,
    categoryName: budget.category.name,
    limitCents: budget.limitCents,
  }));

  return (
    <main className="mx-auto my-6 max-w-6xl space-y-5 px-4 pb-10 pt-2 text-slate-100 sm:px-5 lg:my-10 lg:space-y-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {user.role === "SERVER_ADMIN" ? (
            <Link
              href="/settings/admin"
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Server admin
            </Link>
          ) : null}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
      <SettingsForms
        defaults={{
          displayName: user.displayName,
          countryCode: user.countryCode,
          timezone: user.timezone,
        }}
        profileEmail={user.email}
        hasPassword={user.passwordHash != null}
        joinedAt={user.createdAt.toISOString()}
        accounts={accountOptions}
        accountItems={accountItems}
        expenseCategories={expenseCategoryOptions}
        budgets={budgetItems}
        defaultExpenseAccountId={user.defaultExpenseAccountId}
        budgetAlertEmailConfigured={isBudgetAlertEmailConfigured()}
      />
    </main>
  );
}
