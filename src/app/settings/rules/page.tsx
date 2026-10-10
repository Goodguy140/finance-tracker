import { TransactionRulesPanel } from "@/components/transaction-rules-panel";
import { SettingsPage } from "@/components/settings/ui";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";
import type { RuleTransactionType } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";

export const dynamic = "force-dynamic";

export default async function RulesSettingsPage() {
  const { user } = await requireLoadedUser();
  const [ruleContext, categories, accounts, tags] = await Promise.all([
    loadRuleContext(user.id),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, archived: true } }),
    prisma.tag.findMany({
      where: { userId: user.id },
      orderBy: { nameKey: "asc" },
      select: { id: true, name: true, _count: { select: { transactions: true } } },
    }),
  ]);
  const hiddenTitleKeys = new Set(ruleContext.hiddenTitleKeys);
  const learnedKeys = new Set(ruleContext.learned.map((l) => normalizeExpenseTitleKey(l.title)));

  return (
    <SettingsPage section="rules">
      <p className="max-w-prose text-sm text-slate-400">
        Rules apply as you type in the add and edit forms, to CSV imports, and to bank transactions waiting for review.
        Nothing from your bank is added without you approving it.
      </p>
      <TransactionRulesPanel
        rules={ruleContext.rules}
        learned={ruleContext.learned.map((l) => ({
          ...l,
          hidden: hiddenTitleKeys.has(normalizeExpenseTitleKey(l.title)),
        }))}
        orphanHiddenTitles={ruleContext.hiddenTitleKeys.filter((key) => !learnedKeys.has(key))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind as RuleTransactionType }))}
        accounts={accounts}
        tags={tags.map((t) => ({ id: t.id, name: t.name, transactionCount: t._count.transactions }))}
      />
    </SettingsPage>
  );
}
