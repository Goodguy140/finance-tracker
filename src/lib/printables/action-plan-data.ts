import { AccountType, PlaidStagedStatus } from "@prisma/client";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { computeRoomYear, REGISTERED_ACCOUNT_TYPES, roomFlowsFromData, roomYearFor, type RegisteredAccountType } from "@/lib/contribution-room";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { emergencyFundCents, monthlyRecurringCents, SCORE_LOOKBACK_MONTHS } from "@/lib/financial-score";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { formatCurrency } from "@/lib/money";
import { computeNetWorth } from "@/lib/net-worth";
import { loadBalanceInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { savedByTransferByMonth } from "@/lib/savings-transfers";
import {
  blankPlanSteps,
  buildActionPlan,
  monthlyAverages,
  PAID_IN_FULL_WINDOW_DAYS,
  STALE_BALANCE_DAYS,
  type ActionPlan,
  type PlanBill,
  type PlanFacts,
  type PlanHorizon,
} from "./action-plan";
import { loadForecastRules } from "./templates-data";

type PlanUser = { id: string; timezone: string | null; countryCode: string | null };

const IRREGULAR_CADENCES = new Set(["QUARTERLY", "YEARLY", "BIENNIAL"]);
const RETIREMENT_TYPES: ReadonlySet<string> = new Set<AccountType>([AccountType.RRSP, AccountType.TFSA, AccountType.NON_REGISTERED]);

/** The action plan for one user; a blank one reads nothing of theirs beyond the currency. */
export async function loadActionPlan(user: PlanUser, mode: "filled" | "blank", range: PlanHorizon): Promise<ActionPlan> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  if (mode === "blank") return { mode, currency, todayYmd, range, facts: null, steps: blankPlanSteps() };
  const facts = await loadPlanFacts(user, todayYmd, currency);
  return {
    mode,
    currency,
    todayYmd,
    range,
    facts,
    steps: buildActionPlan(facts, (cents) => formatCurrency(cents, currency, "en-CA")),
  };
}

async function loadPlanFacts(user: PlanUser, todayYmd: string, currency: string): Promise<PlanFacts> {
  const currentYm = todayYmd.slice(0, 7);
  const months = Array.from({ length: SCORE_LOOKBACK_MONTHS }, (_, i) => shiftYm(currentYm, i - SCORE_LOOKBACK_MONTHS));
  const since = startOfMonthYm(months[0]);
  const [financial, txs, savings, balances, goals, roomData, rules, budgets, transferRules, reviewQueueCount] = await Promise.all([
    loadFinancialScore(user),
    loadReportTxs(user.id, since, currency),
    loadSavingsTransfers(user.id, since, currency),
    loadBalanceInputs(user.id),
    loadSavingsGoals(user),
    loadContributionRoomData(user.id),
    loadForecastRules(user.id, currency),
    prisma.budget.findMany({ where: { userId: user.id, limitCents: { gt: 0 } }, select: { categoryId: true } }),
    prisma.recurringTransaction.count({ where: { userId: user.id, enabled: true, type: "TRANSFER" } }),
    prisma.plaidStagedTransaction.count({ where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW } }),
  ]);

  const averages = monthlyAverages(
    txs,
    months,
    savings.savingsAccountIds.size > 0 ? savedByTransferByMonth(savings.txs, savings.savingsAccountIds, months) : null,
  );
  const budgeted = new Set(budgets.map((b) => b.categoryId));

  // Balances read the way net worth reads them: archived and other-currency accounts left out.
  const netWorth = computeNetWorth({ ...balances, months: [], todayYmd, currency });
  const latest = new Map(netWorth.accounts.map((a) => [a.accountId, a.latest]));
  const active = balances.accounts.filter((a) => !a.archived);
  const staleBefore = dateFromYmd(todayYmd).getTime() - STALE_BALANCE_DAYS * 86_400_000;
  const owing = (type: AccountType) => netWorth.accounts.filter((a) => a.counted && a.type === type && a.latest && a.latest.cents > 0);
  const owed = (type: AccountType) => owing(type).map((a) => ({ name: a.name, balanceCents: a.latest!.cents }));
  // What each card with a balance had charged to it in the window before that balance was read:
  // a balance no larger than that is being paid off each statement.
  const cards = await Promise.all(
    owing(AccountType.CREDIT_CARD).map(async (a) => {
      const end = a.latest!.date;
      const date = { gt: new Date(end.getTime() - PAID_IN_FULL_WINDOW_DAYS * 86_400_000), lte: end };
      const [logged, waiting] = await Promise.all([
        prisma.transaction.aggregate({
          where: { userId: user.id, accountId: a.accountId, type: "EXPENSE", date },
          _sum: { amountCents: true },
        }),
        // A synced balance already includes charges still waiting in the review queue; the
        // ones the matcher paired with an entry are counted above already.
        prisma.plaidStagedTransaction.aggregate({
          where: {
            userId: user.id,
            status: PlaidStagedStatus.NEEDS_REVIEW,
            type: "EXPENSE",
            matchTransactionId: null,
            plaidAccount: { accountId: a.accountId },
            date,
          },
          _sum: { amountCents: true },
        }),
      ]);
      return {
        name: a.name,
        balanceCents: a.latest!.cents,
        recentChargesCents: (logged._sum.amountCents ?? 0) + (waiting._sum.amountCents ?? 0),
      };
    }),
  );

  // Bills: overdue and the next 30 days, and the irregular ones over the next year.
  const forecast = forecastRecurringOccurrences(rules, { todayYmd, currentYm, days: 365 });
  const bill = (o: (typeof forecast.occurrences)[number]): PlanBill => ({ name: o.rule.name, amountCents: o.rule.amountCents, dateYmd: ymdFromDateUtc(o.date) });
  const expenses = forecast.occurrences.filter((o) => o.rule.type === "EXPENSE");
  const in30 = ymdFromDateUtc(new Date(dateFromYmd(todayYmd).getTime() + 30 * 86_400_000));
  const seenIrregular = new Set<string>();
  const irregular = expenses.filter((o) => {
    if (!IRREGULAR_CADENCES.has(o.rule.cadence) || o.overdue || seenIrregular.has(o.rule.id)) return false;
    seenIrregular.add(o.rule.id);
    return true;
  });
  const monthIndex = (ymd: string) => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7));
  const recurringMonthly = monthlyRecurringCents(rules, "EXPENSE", todayYmd);

  const today = dateFromYmd(todayYmd);
  const roomFlows = roomFlowsFromData(roomData);
  const heldTypes = new Set<RegisteredAccountType>([...Object.values(roomData.accountTypes), ...roomData.entries.map((e) => e.accountType)]);

  return {
    currency,
    todayYmd,
    countryCode: user.countryCode ?? "CA",
    monthsMeasured: averages.months.length,
    avgIncomeCents: averages.incomeCents,
    avgSpendingCents: averages.spendingCents,
    avgSavedCents: averages.savedCents,
    monthsInRed: averages.monthsInRed,
    score: financial.score,
    emergencyFundCents: emergencyFundCents(
      balances.accounts.map((a) => ({ ...a, latestCents: latest.get(a.id)?.cents ?? null })),
      currency,
    ),
    cards,
    loans: owed(AccountType.LOAN),
    hasCardAccount: active.some((a) => a.type === AccountType.CREDIT_CARD),
    topCategories: averages.categories.slice(0, 8).map((c) => ({ name: c.name, avgCents: c.avgCents, budgeted: budgeted.has(c.categoryId) })),
    budgetCount: budgeted.size,
    recurringBills: { count: recurringMonthly.length, monthlyCents: recurringMonthly.reduce((s, b) => s + b.cents, 0) },
    overdueBills: expenses.filter((o) => o.overdue).map(bill),
    next30Bills: expenses.filter((o) => !o.overdue && ymdFromDateUtc(o.date) <= in30).map(bill),
    irregularBills: irregular.map((o) => {
      const b = bill(o);
      return { ...b, monthsAway: Math.max(1, monthIndex(b.dateYmd) - monthIndex(todayYmd)) };
    }),
    hasSavingsTransferRule: transferRules > 0,
    goals: goals.goals.map((g) => ({
      name: g.name,
      currency: g.currency,
      remainingCents: g.progress.remainingCents,
      targetYmd: g.targetYmd,
      monthsLeft: g.progress.monthsLeft,
      monthlyNeededCents: g.progress.monthlyNeededCents,
      status: g.progress.status,
    })),
    room: REGISTERED_ACCOUNT_TYPES.filter((t) => heldTypes.has(t)).map((t) => {
      const r = computeRoomYear(t, roomYearFor(t, today), roomData.entries, roomFlows);
      return { accountType: t, year: r.year, remainingCents: r.remainingCents, penaltyExcessCents: r.penaltyExcessCents };
    }),
    staleBalances: netWorth.accounts
      .filter((a) => a.counted && a.latest && a.latest.date.getTime() < staleBefore)
      .map((a) => a.name),
    hasRetirementAccount: active.some((a) => RETIREMENT_TYPES.has(a.type)),
    reviewQueueCount,
  };
}
