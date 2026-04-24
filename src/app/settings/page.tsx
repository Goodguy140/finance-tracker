import { CategoryKind } from "@prisma/client";
import Link from "next/link";
import { SettingsForms } from "@/components/forms";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export default async function SettingsPage() {
  const user = await requireUser();
  const [accounts, categories, budgets] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: [{ periodMonth: "desc" }, { category: { name: "asc" } }] }),
  ]);

  const accountOptions = accounts.map((account) => ({ id: account.id, name: account.name }));
  const accountItems = accounts.map((account) => ({ id: account.id, name: account.name, type: account.type }));
  const expenseCategoryOptions = categories.map((category) => ({ id: category.id, name: category.name }));
  const budgetItems = budgets.map((budget) => ({
    id: budget.id,
    periodMonth: budget.periodMonth,
    categoryName: budget.category.name,
    limitCents: budget.limitCents,
  }));

  return (
    <main className="mx-auto my-8 max-w-2xl space-y-4 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link href="/" className="text-blue-300 hover:text-blue-200 underline">Back to dashboard</Link>
      </div>
      {user.role === "SERVER_ADMIN" && (
        <Link href="/settings/admin" className="inline-block rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800">
          Server Admin Settings
        </Link>
      )}
      <SettingsForms
        defaults={{
          displayName: user.displayName,
          countryCode: user.countryCode,
          timezone: user.timezone,
        }}
        accounts={accountOptions}
        accountItems={accountItems}
        expenseCategories={expenseCategoryOptions}
        budgets={budgetItems}
      />
    </main>
  );
}
