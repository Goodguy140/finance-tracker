import { CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import Link from "next/link";
import { SettingsForms } from "@/components/forms";
import type { SubscriptionView } from "@/components/subscriptions-panel";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";
import { getPlaidConfig } from "@/lib/plaid/config";
import { describePlaidCostWarning } from "@/lib/plaid/cost";
import { plaidFakeClientEnabled } from "@/lib/plaid/service";
import {
  describeHistorySetting,
  describeShortfall,
  HISTORY_WINDOWS,
} from "@/lib/plaid/window";
import type { PlaidConnectionsPanelProps } from "@/components/plaid-connections-panel";

export const dynamic = "force-dynamic";

const cadenceLabels: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

type SearchParams = Promise<{ linked?: string | string[] }>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await requireLoadedUser();
  const { user, mfa } = loaded;
  const sp = await searchParams;
  const linkedRaw = Array.isArray(sp.linked) ? sp.linked[0] : sp.linked;
  const [
    accounts,
    categories,
    budgets,
    subscriptionRules,
    apiTokenRecords,
    passkeyRecords,
    recoveryCodesRemaining,
    authAccounts,
    googleProvider,
    authentikProvider,
    plaidItems,
    plaidConfig,
    plaidFakeLink,
  ] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: [{ periodMonth: "desc" }, { category: { name: "asc" } }] }),
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
    prisma.personalAccessToken.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    }),
    prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true },
    }),
    prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.authAccount.findMany({ where: { userId: user.id }, select: { provider: true } }),
    getGoogleProvider(),
    getAuthentikProvider(),
    prisma.plaidItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { plaidAccounts: { orderBy: { name: "asc" } } },
    }),
    getPlaidConfig(),
    plaidFakeClientEnabled(),
  ]);

  const availableProviders = [
    ...(googleProvider ? ["google"] : []),
    ...(authentikProvider ? ["authentik"] : []),
  ];
  const linkedProviders = [...new Set(authAccounts.map((a) => a.provider))];
  const security = {
    hasPassword: user.passwordHash != null,
    passkeys: passkeyRecords.map((pk) => ({
      id: pk.id,
      name: pk.name,
      createdAt: pk.createdAt.toISOString(),
      lastUsedAt: pk.lastUsedAt ? pk.lastUsedAt.toISOString() : null,
      backedUp: pk.backedUp,
    })),
    recoveryCodesRemaining,
    freshUntil: mfa.verified && mfa.verifiedAt != null ? mfa.verifiedAt + MFA_STEP_UP_MAX_AGE_MS : null,
    linkedProviders,
    availableProviders,
    linkedJustNow: linkedRaw && linkedProviders.includes(linkedRaw) ? linkedRaw : null,
  };

  const apiTokens = apiTokenRecords.map((token) => ({
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: token.scopes,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
  }));

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

  const subscriptions: SubscriptionView[] = subscriptionRules.map((rule) => {
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

  const plaid: PlaidConnectionsPanelProps = {
    configured: plaidConfig !== null,
    fakeLink: plaidFakeLink,
    environment: plaidConfig?.environment ?? null,
    historyWindows: HISTORY_WINDOWS.map((w) => ({ days: w.days, label: w.label })),
    accountOptions: activeAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
    })),
    mfa: { enrolled: passkeyRecords.length > 0, freshUntil: security.freshUntil },
    items: plaidItems.map((item) => ({
      id: item.id,
      institutionName: item.institutionName ?? "Your bank",
      status: item.status,
      errorMessage: item.errorMessage,
      // Read from the stored cutoff rather than recomputed, so what the user was promised
      // when they linked cannot drift as days pass.
      historyLine: describeHistorySetting(item.requestedDays, item.historyCutoff),
      shortfallLine: describeShortfall({
        institutionName: item.institutionName,
        requestedDays: item.requestedDays,
        requestedCutoff: item.historyCutoff,
        earliestObserved: item.initialSyncDoneAt ? item.earliestObservedAt : null,
      }),
      // Plaid bills per connected item per month, whether or not it works. A connection
      // that cannot sync is money leaving with nothing coming back, so say so plainly
      // rather than leaving a quietly broken row in the list.
      costWarning: describePlaidCostWarning({
        status: item.status,
        consentExpiresAt: item.consentExpiresAt,
        hasMappedAccount: item.plaidAccounts.some((a) => a.accountId !== null && a.syncEnabled),
      }),
      lastSyncedLabel: item.lastSyncedAt ? formatDateOnlyUtc(item.lastSyncedAt) : null,
      consentExpiresLabel: item.consentExpiresAt ? formatDateOnlyUtc(item.consentExpiresAt) : null,
      accounts: item.plaidAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        officialName: account.officialName,
        mask: account.mask,
        typeLabel: account.plaidSubtype
          ? `${account.plaidType} · ${account.plaidSubtype}`
          : account.plaidType,
        currency: account.currency,
        accountId: account.accountId,
        syncEnabled: account.syncEnabled,
      })),
    })),
  };

  return (
    <main className="mx-auto my-6 w-full max-w-6xl space-y-5 px-4 pb-10 pt-2 text-slate-100 sm:px-5 lg:my-10 lg:space-y-6 lg:px-8">
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
        subscriptions={subscriptions}
        defaultExpenseAccountId={user.defaultExpenseAccountId}
        budgetAlertEmailConfigured={isBudgetAlertEmailConfigured()}
        budgetAlertEmailEnabled={user.budgetAlertEmailEnabled}
        apiTokens={apiTokens}
        security={security}
        plaid={plaid}
      />
    </main>
  );
}
