import { prisma } from "@/lib/prisma";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm } from "@/lib/dashboard-period";
import { computeNetWorth, type BalanceReading, type BalanceReadingSource, type NetWorth, type NetWorthAccount } from "@/lib/net-worth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import type { ProjectableRule } from "@/lib/projected-balances";
import { plannedAsForecastRules } from "@/lib/planned-transactions";
import { loadOpenPlannedTransactions } from "@/lib/planned-transactions-data";

/** Months the net-worth chart covers, ending with the current one. */
export const NET_WORTH_MONTHS = 12;

/**
 * Every account and every balance reading for one user: what `computeNetWorth` takes. Every
 * reading is loaded, not just a window's: an account whose last balance predates the window
 * still counts at its start.
 */
export async function loadBalanceInputs(userId: string): Promise<{
  accounts: Array<NetWorthAccount & { countsAsSavings: boolean }>;
  readings: BalanceReading[];
}> {
  const [accounts, balances, portfolio] = await Promise.all([
    prisma.account.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, currency: true, archived: true, countsAsSavings: true, creditLimitCents: true },
    }),
    prisma.accountBalanceSnapshot.findMany({
      where: { userId },
      select: { accountId: true, date: true, balanceCents: true, source: true },
    }),
    prisma.portfolioSnapshot.findMany({
      where: { userId },
      select: { accountId: true, date: true, totalValueCents: true },
    }),
  ]);
  return {
    accounts,
    readings: [
      ...balances.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        cents: b.balanceCents,
        source: (b.source === "PLAID" ? "PLAID" : "MANUAL") as BalanceReadingSource,
      })),
      ...portfolio.map((p) => ({ accountId: p.accountId, date: p.date, cents: p.totalValueCents, source: "PORTFOLIO" as const })),
    ],
  };
}

/** Net worth for one user over the trailing year. */
export async function loadNetWorth(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<NetWorth> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const { accounts, readings } = await loadBalanceInputs(user.id);
  const thisYm = todayYmd.slice(0, 7);
  const months = Array.from({ length: NET_WORTH_MONTHS }, (_, i) => shiftYm(thisYm, i - NET_WORTH_MONTHS + 1));
  return computeNetWorth({ accounts, readings, months, todayYmd, currency });
}

/**
 * What a balance projection applies: the user's recurring rules and open one-off plans
 * (`projectBalances` picks the ones it can) and whether they asked for transfers to be included.
 */
export async function loadProjectionInputs(
  userId: string,
): Promise<{ rules: ProjectableRule[]; includeTransfers: boolean }> {
  const [rules, user, plans] = await Promise.all([
    prisma.recurringTransaction.findMany({
      where: { userId, enabled: true, type: { in: ["EXPENSE", "INCOME", "TRANSFER"] } },
      select: {
        id: true,
        accountId: true,
        transferAccountId: true,
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        nextExpectedDate: true,
        anchorDay: true,
        endDate: true,
        enabled: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { projectionIncludesTransfers: true } }),
    loadOpenPlannedTransactions(userId),
  ]);
  const planned = plannedAsForecastRules(
    plans.map((p) => ({ id: p.id, accountId: p.accountId, name: p.name, type: p.type, amountCents: p.amountCents, date: p.date })),
  );
  return { rules: [...rules, ...planned], includeTransfers: user?.projectionIncludesTransfers ?? false };
}
