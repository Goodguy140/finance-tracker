import { cache } from "react";
import { getCountryConfig } from "@/lib/country-config";
import { prisma } from "@/lib/prisma";
import { buildInsights, type BuiltInsights } from "./index";
import type { InsightTx } from "./types";
import { daysAgo, moneyFormatter } from "./util";

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
 */
export const loadInsights = cache(async (userId: string, countryCode: string): Promise<LoadedInsights> => {
  const now = new Date();
  const since = daysAgo(now, INSIGHT_HISTORY_DAYS);
  const [transactions, staged, rules, budgets, preference, dismissals] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: since } },
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
      where: { userId },
      select: { id: true, name: true, type: true, amountCents: true, cadence: true, enabled: true, categoryId: true },
    }),
    prisma.budget.findMany({ where: { userId }, select: { categoryId: true, periodMonth: true } }),
    prisma.insightPreference.findUnique({ where: { userId }, select: { habitDetectionEnabled: true } }),
    prisma.insightDismissal.findMany({ where: { userId }, select: { insightKey: true, snoozedUntil: true } }),
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

  const currency = getCountryConfig(countryCode).defaultCurrency;
  const habitsEnabled = preference?.habitDetectionEnabled ?? true;
  const built = buildInsights({
    txs,
    rules,
    budgets,
    now,
    fmt: moneyFormatter(currency),
    habitsEnabled,
    dismissals,
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
