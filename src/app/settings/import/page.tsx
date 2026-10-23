import { CategoryKind } from "@prisma/client";
import { ExpenseCsvImportForm } from "@/components/forms/expense-forms";
import { SettingsPage } from "@/components/settings/ui";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ImportSettingsPage() {
  const { user } = await requireLoadedUser();
  const [accounts, categories, incomeCategories] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.INCOME }, orderBy: { name: "asc" } }),
  ]);
  return (
    <SettingsPage section="import">
      <ExpenseCsvImportForm
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        expenseCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
        incomeCategories={incomeCategories.map((c) => ({ id: c.id, name: c.name }))}
        defaultExpenseAccountId={user.defaultExpenseAccountId}
      />
    </SettingsPage>
  );
}
