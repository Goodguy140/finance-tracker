import { CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import { SettingsPage } from "@/components/settings/ui";
import { SubscriptionsPanel, type SubscriptionView } from "@/components/subscriptions-panel";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const cadenceLabels: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

export default async function SubscriptionsSettingsPage() {
  const { user } = await requireLoadedUser();
  const [accounts, categories, rules] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.recurringTransaction.findMany({
      where: { userId: user.id, type: TransactionType.EXPENSE },
      include: {
        account: true,
        category: true,
        subscriptionMembers: {
          orderBy: { createdAt: "asc" },
          include: { shareStatuses: { select: { expectedDate: true, billSent: true, paid: true } } },
        },
      },
      orderBy: [{ enabled: "desc" }, { nextExpectedDate: "asc" }],
    }),
  ]);

  const subscriptions: SubscriptionView[] = rules.map((rule) => {
    const nextYmd = ymdFromDateUtc(rule.nextExpectedDate);
    return {
      id: rule.id,
      name: rule.name,
      amountCents: rule.amountCents,
      accountId: rule.accountId,
      accountLabel: `${rule.account.name} (${formatAccountTypeLabel(rule.account.type)})`,
      categoryId: rule.categoryId,
      categoryLabel: rule.category.name,
      cadence: rule.cadence,
      cadenceLabel: cadenceLabels[rule.cadence],
      nextExpectedDateYmd: nextYmd,
      nextExpectedDateDisplay: formatDateOnlyUtc(rule.nextExpectedDate),
      endDateYmd: rule.endDate ? ymdFromDateUtc(rule.endDate) : null,
      note: rule.note,
      enabled: rule.enabled,
      postMode: rule.postMode,
      members: rule.subscriptionMembers.map((member) => {
        const status = member.shareStatuses.find((s) => ymdFromDateUtc(s.expectedDate) === nextYmd);
        return {
          id: member.id,
          name: member.name,
          shareCents: member.shareCents,
          billSent: status?.billSent ?? false,
          paid: status?.paid ?? false,
        };
      }),
    };
  });

  return (
    <SettingsPage section="subscriptions">
      <SubscriptionsPanel
        subscriptions={subscriptions}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        expenseCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
        defaultExpenseAccountId={user.defaultExpenseAccountId}
      />
    </SettingsPage>
  );
}
