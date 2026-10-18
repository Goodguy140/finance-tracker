import { TransactionType } from "@prisma/client";
import { cache } from "react";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import { loadSavingsTransfers } from "@/lib/reports/load";
import { savedByTransferByMonth } from "@/lib/savings-transfers";
import { buildInsights, type BuiltInsights } from "./index";
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
  const [transactions, staged, rules, budgets, preference, dismissals, savings] = await Promise.all([
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
      select: {
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
      },
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
      select: { id: true, name: true, type: true, amountCents: true, cadence: true, enabled: true, categoryId: true },
    }),
    prisma.budget.findMany({ where: { userId }, select: { categoryId: true, periodMonth: true } }),
    prisma.insightPreference.findUnique({ where: { userId }, select: { habitDetectionEnabled: true } }),
    prisma.insightDismissal.findMany({ where: { userId }, select: { insightKey: true, snoozedUntil: true } }),
    // What moved into "Counts as savings" accounts: the savings rate the score uses.
    loadSavingsTransfers(userId, since, currency),
  ]);

  const plaidByTx = new Map(staged.map((row) => [row.resolvedTransactionId as string, row]));
  const txs: InsightTx[] = transactions.map((t) => {
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
  });

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
    clock,
  });

  const byId = new Map(txs.map((tx) => [tx.id, tx]));
  const evidence = new Map<string, InsightTx>();
  for (const insight of [...built.visible, ...built.dismissed]) {
    for (const id of insight.evidenceTxIds) {
      const tx = byId.get(id);
      if (tx) evidence.set(id, tx);
    }
  }
  return { ...built, habitsEnabled, evidence, currency };
});
