import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { buildRegister } from "@/lib/account-register";
import { loadRolloverCarries } from "@/lib/budget-rollover";
import { loadRecentCardCharges } from "@/lib/card-charges";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { AccountType, InvestmentFlowDirection, TransactionType } from "@prisma/client";
import {
  computeFinancialScore,
  emergencyFundCents,
  EVERYDAY_ACCOUNT_TYPES,
  guessSpendingRole,
  isEmergencyFundAccount,
  LONG_TERM_ACCOUNT_TYPES,
  SCORE_LOOKBACK_MONTHS,
  type FinancialScore,
  type FinancialScoreChange,
  type ScoreCard,
  type ScoreLoan,
} from "@/lib/financial-score";
import { firstBelowZero, lowestBalanceByMonth, monthEndReadings, netWorthMovement, paymentsIntoByMonth } from "@/lib/financial-score-inputs";
import { inCurrencyWhere } from "@/lib/home-currency";
import { LOW_BALANCE_MAX_READING_AGE_DAYS } from "@/lib/insights/ahead";
import { MONTHLY_FACTOR } from "@/lib/insights/recurring-detection";
import { formatCurrency } from "@/lib/money";
import { computeNetWorth, isLiabilityType } from "@/lib/net-worth";
import { loadBalanceInputs, loadProjectionInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { projectBalances } from "@/lib/projected-balances";
import { loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { savedByTransferByMonth, savingsCentsFor } from "@/lib/savings-transfers";

/**
 * The financial score for one user, as Insights and Reports both show it. It always covers the
 * full months before today and every entry, whatever period or tag the page is filtered to.
 */
/** Every month from `since` through the current one, as `YYYY-MM`. */
function monthsSince(since: Date, todayYmd: string): string[] {
  const out: string[] = [];
  for (let ym = since.toISOString().slice(0, 7); ym <= todayYmd.slice(0, 7); ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

/** How far ahead the cash outlook looks for an account going below zero. */
const OUTLOOK_DAYS = 60;

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

export function loadFinancialScore(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<{ score: FinancialScore; currency: string }> {
  return loadFinancialScoreFor(user.id, user.timezone, user.countryCode);
}

/**
 * Cached per request, keyed on plain values (`cache` compares arguments by identity): a page
 * and the printables built in the same render share one load.
 */
const loadFinancialScoreFor = cache(async (
  userId: string,
  timezone: string | null,
  countryCode: string | null,
): Promise<{ score: FinancialScore; currency: string }> => {
  const user = { id: userId, timezone, countryCode };
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const thisYm = todayYmd.slice(0, 7);
  const since = startOfMonthYm(shiftYm(thisYm, -SCORE_LOOKBACK_MONTHS));
  // Yearly budgets count spending from 1 January of the last scored month's year.
  const january = startOfMonthYm(`${shiftYm(thisYm, -1).slice(0, 4)}-01`);
  const txsSince = january < since ? january : since;
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  // Full months the score looks back over, oldest first.
  const scoredMonths = Array.from({ length: SCORE_LOOKBACK_MONTHS }, (_, i) => shiftYm(thisYm, i - SCORE_LOOKBACK_MONTHS));
  const [txs, savings, budgets, yearlyBudgets, recurring, balances, otherCurrencyUsed, debtTerms, profile, categories, projectionInputs] =
    await Promise.all([
      loadReportTxs(user.id, txsSince, currency),
      loadSavingsTransfers(user.id, since, currency),
      prisma.budget.findMany({
        where: { userId: user.id },
        select: { categoryId: true, periodMonth: true, limitCents: true, category: { select: { name: true } } },
      }),
      prisma.yearlyBudget.findMany({
        where: { userId: user.id },
        select: { categoryId: true, year: true, limitCents: true, category: { select: { name: true } } },
      }),
      prisma.recurringTransaction.findMany({
        // A bill on an account in another currency can't be weighed against home-currency income.
        where: { userId: user.id, enabled: true, account: { currency } },
        select: {
          name: true,
          type: true,
          amountCents: true,
          cadence: true,
          enabled: true,
          endDate: true,
          transferAccountId: true,
          category: { select: { name: true } },
        },
      }),
      loadBalanceInputs(user.id),
      // Accounts in another currency with entries in the scored months: left out, and named.
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
          date: { gte: since, lt: startOfMonthYm(thisYm) },
          account: { currency: { not: currency } },
        },
        select: { accountId: true },
        distinct: ["accountId"],
      }),
      prisma.account.findMany({
        where: { userId: user.id, archived: false, currency, type: { in: [AccountType.CREDIT_CARD, AccountType.LOAN, AccountType.MORTGAGE] } },
        select: { id: true, interestRateBps: true, minimumPaymentCents: true },
      }),
      prisma.user.findUnique({ where: { id: user.id }, select: { birthYear: true } }),
      prisma.category.findMany({
        where: { userId: user.id, kind: "EXPENSE" },
        select: { id: true, name: true, groupName: true, spendingRole: true },
      }),
      loadProjectionInputs(user.id),
    ]);
  const scoreBudgets = budgets.map((b) => ({ categoryId: b.categoryId, categoryName: b.category.name, periodMonth: b.periodMonth, limitCents: b.limitCents }));
  const rolloverCarries = await loadRolloverCarries(prisma, user.id, currency, [...scoredMonths].reverse(), scoreBudgets);
  // Each account's latest balance as of today, read the way net worth reads it.
  const worth = computeNetWorth({ ...balances, months: [], todayYmd, currency });
  const latestRow = new Map(worth.accounts.map((row) => [row.accountId, row]));
  const latest = new Map(worth.accounts.map((row) => [row.accountId, row.latest?.cents ?? null]));
  const usedIds = new Set(otherCurrencyUsed.map((row) => row.accountId));
  const otherCurrencyAccounts = balances.accounts
    .filter(
      (a) =>
        !a.archived &&
        a.currency.toUpperCase() !== currency.toUpperCase() &&
        (usedIds.has(a.id) || (isEmergencyFundAccount(a) && latest.get(a.id) != null)),
    )
    .map((a) => ({ name: a.name, currency: a.currency.toUpperCase() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Accounts in the score's currency, by what the score reads from them.
  const home = balances.accounts.filter((a) => !a.archived && a.currency.toUpperCase() === currency.toUpperCase());
  const everyday = home.filter((a) => EVERYDAY_ACCOUNT_TYPES.has(a.type));
  const debts = home.filter((a) => a.type === AccountType.CREDIT_CARD || a.type === AccountType.LOAN || a.type === AccountType.MORTGAGE);
  const longTermAccounts = home.filter((a) => LONG_TERM_ACCOUNT_TYPES.has(a.type));
  const terms = new Map(debtTerms.map((t) => [t.id, t]));

  // Every entry touching an everyday or debt account since the scored months began, or since its
  // latest reading if that is older: the register walks the balance back from that reading.
  const flowIds = [...everyday, ...debts].map((a) => a.id);
  const oldestReading = [...everyday, ...debts].reduce<Date>((min, a) => {
    const d = latestRow.get(a.id)?.latest?.date;
    return d && d < min ? d : min;
  }, since);
  const [flowRows, investmentFlows, longTermTransfers, goals] = await Promise.all([
    flowIds.length
      ? prisma.transaction.findMany({
          where: { userId: user.id, date: { gte: oldestReading }, OR: [{ accountId: { in: flowIds } }, { transferAccountId: { in: flowIds } }] },
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
        })
      : Promise.resolve([]),
    longTermAccounts.length
      ? prisma.investmentFlow.findMany({
          where: { userId: user.id, accountId: { in: longTermAccounts.map((a) => a.id) }, transactionId: null, date: { gte: since, lt: startOfMonthYm(thisYm) } },
          select: { direction: true, amountCents: true },
        })
      : Promise.resolve([]),
    longTermAccounts.length
      ? prisma.transaction.findMany({
          where: {
            userId: user.id,
            type: TransactionType.TRANSFER,
            date: { gte: since, lt: startOfMonthYm(thisYm) },
            AND: [
              { OR: [{ accountId: { in: longTermAccounts.map((a) => a.id) } }, { transferAccountId: { in: longTermAccounts.map((a) => a.id) } }] },
              inCurrencyWhere(currency),
            ],
          },
          select: { date: true, amountCents: true, accountId: true, transferAccountId: true, transferPeerId: true, transferPeerOf: { select: { id: true } } },
        })
      : Promise.resolve([]),
    loadSavingsGoals(user),
  ]);
  const flows = flowRows.map(({ category, ...tx }) => ({ ...tx, categoryName: category.name }));

  // Credit cards with something owing: whether they are paid off each statement.
  const owingCards = debts.filter((a) => a.type === AccountType.CREDIT_CARD && (latestRow.get(a.id)?.latest?.cents ?? 0) > 0);
  const charges = await loadRecentCardCharges(
    user.id,
    owingCards.map((a) => ({ accountId: a.id, balanceDate: latestRow.get(a.id)!.latest!.date })),
  );
  const cards: ScoreCard[] = owingCards.map((a) => ({
    accountId: a.id,
    name: a.name,
    balanceCents: latestRow.get(a.id)!.latest!.cents,
    recentChargesCents: charges.get(a.id) ?? 0,
    creditLimitCents: a.creditLimitCents ?? null,
    interestRateBps: terms.get(a.id)?.interestRateBps ?? null,
    minimumPaymentCents: terms.get(a.id)?.minimumPaymentCents ?? null,
    history: monthEndReadings(
      balances.readings.filter((r) => r.accountId === a.id),
      scoredMonths,
    ),
  }));
  const loans: ScoreLoan[] = debts
    .filter((a) => a.type === AccountType.LOAN || a.type === AccountType.MORTGAGE)
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      type: a.type === AccountType.MORTGAGE ? "MORTGAGE" : "LOAN",
      balanceCents: latestRow.get(a.id)?.latest?.cents ?? null,
      interestRateBps: terms.get(a.id)?.interestRateBps ?? null,
      minimumPaymentCents: terms.get(a.id)?.minimumPaymentCents ?? null,
      paymentsByMonth: paymentsIntoByMonth(flows, a.id),
      recurringPaymentCents: Math.round(
        recurring
          .filter((r) => r.type === TransactionType.TRANSFER && r.transferAccountId === a.id && (!r.endDate || r.endDate.toISOString().slice(0, 10) >= todayYmd))
          .reduce((s, r) => s + r.amountCents * MONTHLY_FACTOR[r.cadence], 0),
      ),
    }));

  // The everyday accounts' lowest combined balance each month.
  const everydayLowsByMonth = lowestBalanceByMonth(
    everyday.map((a) => {
      const reading = latestRow.get(a.id)?.latest ?? null;
      return { reading, rows: buildRegister({ accountId: a.id, liability: false, transactions: flows, reading }) };
    }),
    scoredMonths,
  );

  // Net worth over the scored months, without property values typed in by hand.
  const netWorth = netWorthMovement({
    accounts: home.filter((a) => a.type !== AccountType.PROPERTY).map((a) => ({ id: a.id, name: a.name, liability: isLiabilityType(a.type) })),
    readings: balances.readings,
    months: scoredMonths,
  });

  const projection = projectBalances({ accounts: worth.accounts, ...projectionInputs, todayYmd, currentYm: thisYm, days: [OUTLOOK_DAYS] });
  const outlook = firstBelowZero(projection, todayYmd, LOW_BALANCE_MAX_READING_AGE_DAYS, (d) => shortDate.format(d));

  const longTermIds = new Set(longTermAccounts.map((a) => a.id));
  const contributedCents =
    longTermTransfers.reduce(
      (s, t) => s + savingsCentsFor({ ...t, paired: t.transferPeerId !== null || t.transferPeerOf !== null }, longTermIds),
      0,
    ) +
    investmentFlows.reduce((s, f) => s + (f.direction === InvestmentFlowDirection.CONTRIBUTION ? f.amountCents : -f.amountCents), 0);
  const invested = longTermAccounts.reduce<number | null>((s, a) => {
    const cents = latest.get(a.id);
    return cents == null ? s : (s ?? 0) + cents;
  }, null);

  const score = computeFinancialScore({
    txs,
    budgets: scoreBudgets,
    rolloverCarries,
    yearlyBudgets: yearlyBudgets.map((b) => ({ categoryId: b.categoryId, categoryName: b.category.name, year: b.year, limitCents: b.limitCents })),
    recurring: recurring.map((r) => ({ ...r, categoryName: r.category.name })),
    todayYmd,
    formatCents: (cents) => formatCurrency(cents, currency),
    toSavingsByMonth:
      savings.savingsAccountIds.size > 0
        ? savedByTransferByMonth(savings.txs, savings.savingsAccountIds, monthsSince(since, todayYmd))
        : null,
    emergencyFundCents: emergencyFundCents(
      balances.accounts.map((a) => ({ ...a, latestCents: latest.get(a.id) ?? null })),
      currency,
    ),
    everydayLowsByMonth,
    cards,
    loans,
    netWorth,
    outlook,
    goals: goals.goals
      .filter((g) => g.targetYmd !== null && g.currency.toUpperCase() === currency.toUpperCase())
      .map((g) => ({ name: g.name, status: g.progress.status, monthlyNeededCents: g.progress.monthlyNeededCents })),
    longTerm: {
      accountCount: longTermAccounts.length,
      contributedCents,
      investedCents: invested,
      age: profile?.birthYear ? Number(todayYmd.slice(0, 4)) - profile.birthYear : null,
    },
    categoryRoles: new Map(categories.map((c) => [c.id, c.spendingRole ?? guessSpendingRole(c)])),
    otherCurrencyAccounts,
  });
  if (score.status === "scored") score.change = await recordAndCompare(user.id, score);
  return { score, currency };
});

/**
 * Saves the score for its last month the first time it is worked out after that month ends,
 * and compares it with the month before's saved score. The saved row is never rewritten, so
 * "up 4 since September" keeps meaning the score as it was shown then. Failing to save never
 * stops the page.
 */
async function recordAndCompare(userId: string, score: Extract<FinancialScore, { status: "scored" }>): Promise<FinancialScoreChange | null> {
  const month = score.months[score.months.length - 1];
  const factors = Object.fromEntries(score.factors.map((f) => [f.id, f.score]));
  try {
    const [earlier] = await Promise.all([
      prisma.financialScoreSnapshot.findUnique({ where: { userId_month: { userId, month: shiftYm(month, -1) } } }),
      prisma.financialScoreSnapshot.upsert({
        where: { userId_month: { userId, month } },
        create: { userId, month, score: score.score, factors: JSON.stringify(factors) },
        update: {},
      }),
    ]);
    return earlier ? compareWith(earlier, score) : null;
  } catch {
    return null;
  }
}

/** How the score moved from a saved month, and which factor moved most. */
export function compareWith(
  earlier: { month: string; score: number; factors: string },
  score: Extract<FinancialScore, { status: "scored" }>,
): FinancialScoreChange {
  let before: Record<string, number> = {};
  try {
    before = JSON.parse(earlier.factors) as Record<string, number>;
  } catch {
    // An unreadable row still gives the overall change.
  }
  let mover: FinancialScoreChange["mover"] = null;
  for (const f of score.factors) {
    const was = before[f.id];
    if (typeof was !== "number") continue;
    const delta = f.score - was;
    if (delta !== 0 && (!mover || Math.abs(delta) > Math.abs(mover.delta))) mover = { label: f.label, delta };
  }
  return { fromMonth: earlier.month, fromScore: earlier.score, mover };
}
