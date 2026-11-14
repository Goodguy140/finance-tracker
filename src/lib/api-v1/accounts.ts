import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { loadManualBalances } from "@/lib/api-v1/balances";
import { loadAccountPage, REGISTER_MONTH_OPTIONS, type AccountPage } from "@/lib/account-page-data";
import { cardUtilization, dueDayLabel, HIGH_UTILIZATION_PCT } from "@/lib/credit-cards";
import { ymdFromDateUtc } from "@/lib/date-only";
import type { BalanceReadingSource, NetWorth } from "@/lib/net-worth";
import { loadNetWorth } from "@/lib/net-worth-data";
import { prisma } from "@/lib/prisma";

/**
 * Accounts as the phone app shows them: `/api/v1/net-worth` lists every open account with its
 * latest balance and the net worth they add up to, as Reports' Net worth does, and
 * `/api/v1/accounts/:id` is the website's account page (`/accounts/[id]`): balance, this month's
 * money in and out, the register with its running balance, the bank, recurring rules and goals.
 * Both come from the website's loaders, so the numbers agree with it.
 */

type User = { id: string; timezone: string | null; countryCode: string | null };

const SOURCE = { PLAID: "bank", MANUAL: "manual", PORTFOLIO: "portfolio" } as const satisfies Record<BalanceReadingSource, string>;

function balance(latest: { cents: number; date: Date; source: BalanceReadingSource } | null) {
  return latest ? { cents: latest.cents, date: ymdFromDateUtc(latest.date), source: SOURCE[latest.source] } : null;
}

export function serializeNetWorth(worth: NetWorth) {
  return {
    currency: worth.currency,
    assetsCents: worth.assetsCents,
    liabilitiesCents: worth.liabilitiesCents,
    netCents: worth.netCents,
    /** Month-end net worth over the last year, oldest first; months before any balance are left out. */
    points: worth.points.map((p) => ({ ym: p.ym, label: p.label, netCents: p.netCents })),
    /** Open accounts: assets first, then what is owed, each largest first, those with no balance last. */
    accounts: worth.accounts.map((a) => ({
      id: a.accountId,
      name: a.name,
      type: a.type,
      typeLabel: formatAccountTypeLabel(a.type),
      currency: a.currency,
      /** A card or loan: its balance is what is owed. */
      liability: a.liability,
      /** False for an account in another currency, which the totals leave out. */
      counted: a.counted,
      balance: balance(a.latest),
    })),
  };
}

export type AppNetWorth = ReturnType<typeof serializeNetWorth>;

export async function loadAppNetWorth(user: User): Promise<AppNetWorth> {
  return serializeNetWorth(await loadNetWorth(user));
}

export function serializeAccountPage(page: AccountPage) {
  const { account, liability, latest } = page;
  const isCard = account.type === "CREDIT_CARD";
  const utilization = isCard ? cardUtilization(latest?.cents, account.creditLimitCents) : null;
  return {
    account: {
      id: account.id,
      name: account.name,
      type: account.type,
      typeLabel: formatAccountTypeLabel(account.type),
      currency: account.currency,
      archived: account.archived,
    },
    /** What the phone's Edit sheet starts from: Settings → Accounts' fields. */
    settings: {
      countsAsSavings: account.countsAsSavings,
      creditLimitCents: account.creditLimitCents,
      paymentDueDay: account.paymentDueDay,
      /** A card's, loan's or mortgage's yearly rate in basis points (19.99% is 1999) and minimum a month, for the payoff plan. */
      interestRateBps: account.interestRateBps,
      minimumPaymentCents: account.minimumPaymentCents,
    },
    liability,
    balance: balance(latest),
    /** Month-end balances over the last year (what is owed, for a card or loan), oldest first. */
    history: page.history.map((h) => ({ ym: h.ym, label: h.label, cents: h.cents })),
    thisMonth: page.thisMonth,
    card:
      isCard && (account.creditLimitCents !== null || account.paymentDueDay !== null)
        ? {
            limitCents: account.creditLimitCents,
            utilization,
            /** Use above this share of the limit hurts a credit score. */
            highPct: HIGH_UTILIZATION_PCT,
            /** "the 15th", "the last day". */
            dueDay: account.paymentDueDay === null ? null : dueDayLabel(account.paymentDueDay),
          }
        : null,
    months: page.registerMonths,
    /** Newest first. `inCents` is from the account's side: negative is money out. */
    register: page.register.map((row) => ({
      id: row.id,
      date: ymdFromDateUtc(row.date),
      title: row.title,
      type: row.type.toLowerCase() as Lowercase<typeof row.type>,
      inCents: row.inCents,
      balanceCents: row.balanceCents,
      afterReading: row.afterReading,
    })),
    bank: page.bank
      ? {
          institutionName: page.bank.institutionName,
          lastSyncedAt: page.bank.lastSyncedAt?.toISOString() ?? null,
          /** What needs doing on the website, or why the last sync failed; null when all is well. */
          problem:
            page.bank.attention?.message ?? (page.bank.lastSyncError ? `The last sync failed: ${page.bank.lastSyncError}` : null),
        }
      : null,
    waitingInQueue: page.waitingInQueue,
    rules: page.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      type: rule.type.toLowerCase(),
      amountCents: rule.amountCents,
      cadence: rule.cadence.toLowerCase(),
      date: ymdFromDateUtc(rule.nextExpectedDate),
      transfer: rule.transfer,
    })),
    goals: page.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetCents: goal.targetCents,
      currency: goal.currency,
      percent: Math.round(goal.progress.fraction * 100),
    })),
  };
}

export type AppAccountPage = ReturnType<typeof serializeAccountPage> & {
  /** Balances the person typed in, newest first: the ones they can delete. */
  manualBalances: Awaited<ReturnType<typeof loadManualBalances>>;
};

/** `?months=` as the website's register takes it: 3 or 12, otherwise 3. */
export function registerMonths(value: string | null): number {
  const n = Number(value);
  return (REGISTER_MONTH_OPTIONS as readonly number[]).includes(n) ? n : REGISTER_MONTH_OPTIONS[0];
}

export async function loadAppAccountPage(user: User, accountId: string, months: number): Promise<AppAccountPage | null> {
  const page = await loadAccountPage(user, accountId, months);
  if (!page) return null;
  return { ...serializeAccountPage(page), manualBalances: await loadManualBalances(prisma, user.id, accountId) };
}
