import { prisma } from "@/lib/prisma";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm } from "@/lib/dashboard-period";
import { computeNetWorth, type BalanceReadingSource, type NetWorth } from "@/lib/net-worth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import type { ProjectableRule } from "@/lib/projected-balances";

/** Months the net-worth chart covers, ending with the current one. */
export const NET_WORTH_MONTHS = 12;

/**
 * Net worth for one user over the trailing year. Every reading is loaded, not just the
 * year's: an account whose last balance predates the window still counts at its start.
 */
export async function loadNetWorth(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<NetWorth> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const [accounts, balances, portfolio] = await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, type: true, currency: true, archived: true },
    }),
    prisma.accountBalanceSnapshot.findMany({
      where: { userId: user.id },
      select: { accountId: true, date: true, balanceCents: true, source: true },
    }),
    prisma.portfolioSnapshot.findMany({
      where: { userId: user.id },
      select: { accountId: true, date: true, totalValueCents: true },
    }),
  ]);
  const thisYm = todayYmd.slice(0, 7);
  const months = Array.from({ length: NET_WORTH_MONTHS }, (_, i) => shiftYm(thisYm, i - NET_WORTH_MONTHS + 1));
  return computeNetWorth({
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
    months,
    todayYmd,
    currency,
  });
}

/** The recurring rules a balance projection applies; `projectBalances` picks the ones it can. */
export async function loadProjectionRules(userId: string): Promise<ProjectableRule[]> {
  return prisma.recurringTransaction.findMany({
    where: { userId, enabled: true, type: { in: ["EXPENSE", "INCOME"] } },
    select: {
      accountId: true,
      type: true,
      amountCents: true,
      cadence: true,
      nextExpectedDate: true,
      anchorDay: true,
      endDate: true,
      enabled: true,
    },
  });
}
