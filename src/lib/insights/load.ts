import { TransactionType } from "@prisma/client";
import { cache } from "react";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { roomFlowsFromData } from "@/lib/contribution-room";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { loadNetWorth, loadProjectionRules } from "@/lib/net-worth-data";
import { projectBalances } from "@/lib/projected-balances";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import { loadSavingsTransfers } from "@/lib/reports/load";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { savedByTransferByMonth } from "@/lib/savings-transfers";
import { buildInsights, type BuiltInsights } from "./index";
import { scoreInsights } from "./score";
import type { GapTransferTx } from "./gaps";
import type { InsightTx } from "./types";
import { daysAgo, insightsNow, moneyFormatter, previousFullMonths } from "./util";

/**
 * A little over a year, so a yearly charge can be seen twice and every monthly comparison has
 * its full set of prior months.
 */
export const INSIGHT_HISTORY_DAYS = 400;

export type LoadedInsights = BuiltInsights & {
  habitsEnabled: boolean;
  /** Evidence rows for everything listed, by id, for showing under each insight. */
  evidence: Map<string, InsightTx>;
  currency: string;
};

/**
 * Loads a user's history and derives their insights. Cached per request, so the dashboard
 * card and anything else on the same render share one pass — which is also why `now` is
 * taken here rather than passed in: `cache` keys on argument identity.
 *
 * With `tagId`, everything is worked out from the transactions carrying that tag alone, as if
 * they were the whole history: the Insights page's `?tag=` filter.
 *
 * The detectors work in the user's own calendar (`insightsNow`), as the financial score does.
 */
export const loadInsights = cache(async (
  userId: string,
  countryCode: string,
  timezone: string | null,
  tagId: string | null = null,
): Promise<LoadedInsights> => {
  const clock = new Date();
  const now = insightsNow(timezone, clock);
  const since = daysAgo(now, INSIGHT_HISTORY_DAYS);
  const currency = homeCurrencyOf(countryCode);
  const user = { id: userId, timezone, countryCode };
  const ym = now.toISOString().slice(0, 7);
  const txSelect = {
    id: true,
    type: true,
    amountCents: true,
    date: true,
    title: true,
    note: true,
    categoryId: true,
    accountId: true,
    recurringTransactionId: true,
    category: { select: { name: true } },
    splitParts: { select: { categoryId: true, amountCents: true, category: { select: { name: true } } } },
  } as const;
  const [transactions, staged, rules, budgets, preference, dismissals, savings, financial, ahead, standing, gapData] = await Promise.all([
    prisma.transaction.findMany({
      // Transfers are neither spending nor income: no habit, saving or recurring charge
      // should be read off a card payment. Nor is anything in another currency added in.
      where: {
        userId,
        date: { gte: since },
        type: { not: TransactionType.TRANSFER },
        ...inCurrencyWhere(currency),
        ...(tagId ? { tags: { some: { tagId } } } : {}),
      },
      select: txSelect,
      orderBy: { date: "asc" },
    }),
    // Plaid's merchant name and category live on the staged row only; they sharpen merchant
    // grouping and habit matching for anything that came from a bank.
    prisma.plaidStagedTransaction.findMany({
      where: { userId, resolvedTransactionId: { not: null }, date: { gte: since } },
      select: { resolvedTransactionId: true, merchantName: true, pfcPrimary: true, pfcDetailed: true },
    }),
    prisma.recurringTransaction.findMany({
      where: { userId, account: { currency } },
      select: {
        id: true,
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        enabled: true,
        categoryId: true,
        nextExpectedDate: true,
      },
    }),
    prisma.budget.findMany({ where: { userId }, select: { categoryId: true, periodMonth: true } }),
    prisma.insightPreference.findUnique({ where: { userId }, select: { habitDetectionEnabled: true } }),
    prisma.insightDismissal.findMany({ where: { userId }, select: { insightKey: true, snoozedUntil: true, dismissedCents: true } }),
    // What moved into "Counts as savings" accounts: the savings rate the score uses.
    loadSavingsTransfers(userId, since, currency),
    // The score's suggestions join the list. Not under a tag: the score is of the whole picture.
    tagId ? null : loadFinancialScore(user),
    // Balances and budgets for "Coming up": neither has a meaning under a tag.
    tagId
      ? null
      : Promise.all([loadNetWorth(user), loadProjectionRules(userId), buildMonthlyBudgetProgress(userId, ym)]),
    // Money owed back, registered-account room (Canada only) and savings goals.
    tagId
      ? null
      : Promise.all([
          prisma.owedShare.findMany({
            where: { userId, paidAt: null, transaction: inCurrencyWhere(currency) },
            select: { name: true, amountCents: true, transaction: { select: { date: true, title: true } } },
          }),
          countryCode === "CA" ? loadContributionRoomData(userId) : null,
          loadSavingsGoals(user),
        ]),
    // Transfers and active accounts, for gaps in the log: not under a tag, which has them by design.
    tagId
      ? null
      : Promise.all([
          prisma.transaction.findMany({
            where: { userId, date: { gte: since }, type: TransactionType.TRANSFER, ...inCurrencyWhere(currency) },
            select: { ...txSelect, transferAccountId: true, transferPeerId: true, transferPeerOf: { select: { id: true } } },
            orderBy: { date: "asc" },
          }),
          prisma.account.findMany({
            where: { userId, archived: false, currency },
            select: { id: true, name: true, type: true, countsAsSavings: true },
          }),
        ]),
  ]);

  const plaidByTx = new Map(staged.map((row) => [row.resolvedTransactionId as string, row]));
  const toInsightTx = (t: (typeof transactions)[number]): InsightTx => {
    const plaid = plaidByTx.get(t.id);
    return {
      id: t.id,
      type: t.type,
      amountCents: t.amountCents,
      date: t.date,
      title: t.title,
      note: t.note,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      accountId: t.accountId,
      recurringTransactionId: t.recurringTransactionId,
      splits: t.splitParts.map((p) => ({ categoryId: p.categoryId, categoryName: p.category.name, amountCents: p.amountCents })),
      merchantName: plaid?.merchantName ?? null,
      pfcPrimary: plaid?.pfcPrimary ?? null,
      pfcDetailed: plaid?.pfcDetailed ?? null,
    };
  };
  const txs = transactions.map(toInsightTx);
  const transferTxs: GapTransferTx[] = (gapData?.[0] ?? []).map((t) => ({
    ...toInsightTx(t),
    transferAccountId: t.transferAccountId,
    paired: t.transferPeerId !== null || t.transferPeerOf !== null,
  }));

  const habitsEnabled = preference?.habitDetectionEnabled ?? true;
  const savingsTxs = tagId ? savings.txs.filter((tx) => tx.tagIds?.includes(tagId)) : savings.txs;
  const toSavingsByMonth =
    savings.savingsAccountIds.size > 0
      ? savedByTransferByMonth(savingsTxs, savings.savingsAccountIds, previousFullMonths(now, 3))
      : null;
  const built = buildInsights({
    txs,
    rules,
    budgets,
    now,
    fmt: moneyFormatter(currency),
    habitsEnabled,
    dismissals,
    toSavingsByMonth,
    scoreInsights: financial ? scoreInsights(financial.score) : null,
    projection: ahead
      ? projectBalances({ accounts: ahead[0].accounts, rules: ahead[1], todayYmd: now.toISOString().slice(0, 10), currentYm: ym })
      : null,
    budgetProgress: ahead ? ahead[2].budgets : null,
    score: financial?.score ?? null,
    owed: standing
      ? standing[0]
          .map((share) => ({ name: share.name, amountCents: share.amountCents, date: share.transaction.date, title: share.transaction.title }))
          .sort((a, b) => a.date.getTime() - b.date.getTime())
      : null,
    room:
      standing?.[1] && Object.keys(standing[1].accountTypes).length > 0
        ? {
            entries: standing[1].entries,
            flows: roomFlowsFromData(standing[1]),
            types: [...new Set(Object.values(standing[1].accountTypes))],
          }
        : null,
    // Goals in another currency are not in the home-currency figures these are worded in.
    goals: standing ? standing[2].goals.filter((goal) => goal.currency === currency) : null,
    gaps: gapData ? { transfers: transferTxs, accounts: gapData[1] } : null,
    clock,
  });

  const byId = new Map([...txs, ...transferTxs].map((tx) => [tx.id, tx]));
  const evidence = new Map<string, InsightTx>();
  for (const insight of [...built.visible, ...built.dismissed]) {
    for (const id of insight.evidenceTxIds) {
      const tx = byId.get(id);
      if (tx) evidence.set(id, tx);
    }
  }
  return { ...built, habitsEnabled, evidence, currency };
});
