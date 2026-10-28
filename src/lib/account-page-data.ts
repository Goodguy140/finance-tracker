import type { AccountType } from "@prisma/client";
import { buildRegister, moneyInOut, type RegisterRow } from "@/lib/account-register";
import { shiftYm } from "@/lib/dashboard-period";
import { dateFromYmd } from "@/lib/date-only";
import { computeNetWorth, isLiabilityType, type BalanceReadingSource } from "@/lib/net-worth";
import { loadBalanceInputs, NET_WORTH_MONTHS } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { describePlaidItemAttention, type PlaidItemAttention } from "@/lib/plaid/attention";
import { prisma } from "@/lib/prisma";
import { loadSavingsGoals, type SavingsGoalView } from "@/lib/savings-goals-data";

/** How many months of the register the page shows, newest first. */
export const REGISTER_MONTH_OPTIONS = [3, 12] as const;

export type AccountPage = {
  account: {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    archived: boolean;
    creditLimitCents: number | null;
    paymentDueDay: number | null;
  };
  liability: boolean;
  latest: { cents: number; date: Date; source: BalanceReadingSource } | null;
  /** Month-end balances over the last year, from the readings net worth uses. */
  history: Array<{ ym: string; label: string; cents: number }>;
  register: RegisterRow[];
  registerMonths: number;
  thisMonth: { inCents: number; outCents: number };
  bank: {
    institutionName: string;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
    attention: PlaidItemAttention | null;
  } | null;
  waitingInQueue: number;
  rules: Array<{
    id: string;
    name: string;
    type: string;
    amountCents: number;
    cadence: string;
    nextExpectedDate: Date;
    /** For a transfer: the other account, and whether money arrives here. */
    transfer: { otherName: string; into: boolean } | null;
  }>;
  goals: SavingsGoalView[];
  todayYmd: string;
};

/** Everything `/accounts/[id]` shows, or null when the account is not the user's. */
export async function loadAccountPage(
  user: { id: string; timezone: string | null; countryCode: string | null },
  accountId: string,
  months: number,
): Promise<AccountPage | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: user.id },
    select: {
      id: true,
      name: true,
      type: true,
      currency: true,
      archived: true,
      creditLimitCents: true,
      paymentDueDay: true,
    },
  });
  if (!account) return null;

  const todayYmd = currentYmdInTimeZone(user.timezone);
  const thisYm = todayYmd.slice(0, 7);
  const liability = isLiabilityType(account.type);

  const inputs = await loadBalanceInputs(user.id);
  const readings = inputs.readings.filter((r) => r.accountId === account.id);
  // As its own one-account total, in its own currency, archived or not.
  const worth = computeNetWorth({
    accounts: [{ ...account, archived: false }],
    readings,
    months: Array.from({ length: NET_WORTH_MONTHS }, (_, i) => shiftYm(thisYm, i - NET_WORTH_MONTHS + 1)),
    todayYmd,
    currency: account.currency,
  });
  const latest = worth.accounts[0]?.latest ?? null;
  const history = worth.points.map((p) => ({
    ym: p.ym,
    label: p.label,
    cents: liability ? p.liabilitiesCents : p.assetsCents,
  }));

  const windowStart = dateFromYmd(`${shiftYm(thisYm, -(months - 1))}-01`);
  // Entries after the latest reading are needed to walk its balance forward, however old it is.
  const loadFrom = latest && latest.date < windowStart ? latest.date : windowStart;
  const [transactions, plaidAccount, waitingInQueue, rules, goals] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: loadFrom },
        OR: [{ accountId: account.id }, { transferAccountId: account.id }],
      },
      select: {
        id: true,
        type: true,
        amountCents: true,
        date: true,
        title: true,
        accountId: true,
        transferAccountId: true,
        transferPeerId: true,
        category: { select: { name: true } },
        owedShares: { select: { amountCents: true } },
      },
    }),
    prisma.plaidAccount.findFirst({
      where: { userId: user.id, accountId: account.id, syncEnabled: true },
      select: {
        plaidItem: {
          select: {
            institutionName: true,
            status: true,
            lastSyncedAt: true,
            lastSyncError: true,
            consentExpiresAt: true,
            pendingExpirationAt: true,
            pendingDisconnectAt: true,
            pendingDisconnectReason: true,
            newAccountsAvailableAt: true,
          },
        },
      },
    }),
    prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: "NEEDS_REVIEW", suggestedAccountId: account.id },
    }),
    prisma.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true, OR: [{ accountId: account.id }, { transferAccountId: account.id }] },
      orderBy: { nextExpectedDate: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        nextExpectedDate: true,
        accountId: true,
        account: { select: { name: true } },
        transferAccount: { select: { name: true } },
      },
    }),
    loadSavingsGoals(user),
  ]);

  const register = buildRegister({
    accountId: account.id,
    liability,
    transactions: transactions.map(({ category, ...tx }) => ({ ...tx, categoryName: category.name })),
    reading: latest,
  });
  const item = plaidAccount?.plaidItem ?? null;

  return {
    account,
    liability,
    latest,
    history,
    register: register.filter((row) => row.date >= windowStart),
    registerMonths: months,
    thisMonth: moneyInOut(register, dateFromYmd(`${thisYm}-01`)),
    bank: item
      ? {
          institutionName: item.institutionName ?? "Your bank",
          lastSyncedAt: item.lastSyncedAt,
          lastSyncError: item.lastSyncError,
          attention: describePlaidItemAttention(item),
        }
      : null,
    waitingInQueue,
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      amountCents: rule.amountCents,
      cadence: rule.cadence,
      nextExpectedDate: rule.nextExpectedDate,
      transfer:
        rule.type === "TRANSFER"
          ? rule.accountId === account.id
            ? { otherName: rule.transferAccount?.name ?? "another account", into: false }
            : { otherName: rule.account.name, into: true }
          : null,
    })),
    goals: goals.goals.filter((goal) => goal.account?.id === account.id),
    todayYmd,
  };
}
