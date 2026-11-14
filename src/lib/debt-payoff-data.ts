import type { AccountType } from "@prisma/client";
import { getCountryConfig } from "@/lib/country-config";
import { cardUtilization, type Utilization } from "@/lib/credit-cards";
import { minimumsTotal, simulatePayoff, type Debt, type PayoffResult, type PayoffStrategy } from "@/lib/debt-payoff";
import { isLiabilityType } from "@/lib/net-worth";
import { loadNetWorth } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";

/**
 * The debt payoff page's figures, shared by the website (`/reports/debt`) and the phone
 * (`GET /api/v1/debt-payoff`): every open card, loan and mortgage with what is owed and its terms,
 * and the three ways to pay them off for a monthly amount, which is never less than the minimums.
 */

export const PAYOFF_STRATEGIES: ReadonlyArray<{ id: PayoffStrategy; label: string; hint: string }> = [
  { id: "avalanche", label: "Highest rate first", hint: "Avalanche: the least interest overall." },
  { id: "snowball", label: "Smallest balance first", hint: "Snowball: the first debt is gone soonest." },
  { id: "minimums", label: "Minimums only", hint: "Only what the lenders require, for comparison." },
];

export type DebtAccount = {
  id: string;
  name: string;
  type: AccountType;
  interestRateBps: number | null;
  minimumPaymentCents: number | null;
  /** What is owed and when it was read; null when there is no balance in the home currency. */
  owed: { cents: number; date: Date } | null;
  utilization: Utilization | null;
};

export type DebtPayoffPlan = {
  currency: string;
  /** Today's month, which payoff months count from (1 = next month). */
  thisYm: string;
  liabilities: DebtAccount[];
  /** The ones with something owed, which the plan pays off. */
  debts: Debt[];
  /** Names of debts with no rate or minimum yet, counted as interest-free with no minimum. */
  missing: string[];
  minimumsCents: number;
  monthlyCents: number;
  totalOwedCents: number;
  results: Record<PayoffStrategy, PayoffResult>;
};

export async function loadDebtPayoff(
  user: { id: string; timezone: string | null; countryCode: string | null },
  monthlyCents: number | null,
): Promise<DebtPayoffPlan> {
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const [accounts, netWorth] = await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, interestRateBps: true, minimumPaymentCents: true },
    }),
    loadNetWorth(user),
  ]);
  const balances = new Map(netWorth.accounts.map((row) => [row.accountId, row]));
  const liabilities: DebtAccount[] = accounts
    .filter((a) => isLiabilityType(a.type))
    .map((a) => {
      const row = balances.get(a.id);
      const owed = row?.counted && row.latest ? { cents: row.latest.cents, date: row.latest.date } : null;
      return { ...a, owed, utilization: owed ? cardUtilization(owed.cents, row?.creditLimitCents) : null };
    });

  const debts: Debt[] = [];
  const missing: string[] = [];
  for (const a of liabilities) {
    if (!a.owed || a.owed.cents <= 0) continue;
    if (a.interestRateBps === null || a.minimumPaymentCents === null) missing.push(a.name);
    debts.push({
      id: a.id,
      name: a.name,
      balanceCents: a.owed.cents,
      aprBps: a.interestRateBps ?? 0,
      minimumCents: a.minimumPaymentCents ?? 0,
    });
  }

  const minimumsCents = minimumsTotal(debts);
  const monthly = Math.max(monthlyCents ?? minimumsCents, minimumsCents);
  const results = Object.fromEntries(PAYOFF_STRATEGIES.map((s) => [s.id, simulatePayoff(debts, monthly, s.id)])) as Record<
    PayoffStrategy,
    PayoffResult
  >;
  return {
    currency,
    thisYm: currentYmdInTimeZone(user.timezone).slice(0, 7),
    liabilities,
    debts,
    missing,
    minimumsCents,
    monthlyCents: monthly,
    totalOwedCents: debts.reduce((sum, d) => sum + d.balanceCents, 0),
    results,
  };
}
