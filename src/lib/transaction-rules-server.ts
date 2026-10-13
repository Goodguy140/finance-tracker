import { TransactionType, type TransactionRule } from "@prisma/client";
import { buildExpenseTitleSuggestions, type ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";
import { prisma } from "@/lib/prisma";
import { sortRules, type TransactionRuleInput } from "@/lib/transaction-rules";

/** How far back the learned Title → Category combos look: the most recent titled expenses. */
export const LEARNED_TITLE_HISTORY_LIMIT = 400;

export type RuleContext = {
  rules: TransactionRuleInput[];
  /** Every learned combo, hidden ones included — callers filter with `hiddenTitleKeys`. */
  learned: ExpenseTitleSuggestion[];
  hiddenTitleKeys: string[];
};

export function toTransactionRuleInput(row: TransactionRule): TransactionRuleInput {
  return {
    id: row.id,
    priority: row.priority,
    enabled: row.enabled,
    titleOperator: row.titleOperator,
    titlePattern: row.titlePattern,
    transactionType: row.transactionType,
    matchAccountId: row.matchAccountId,
    minAmountCents: row.minAmountCents,
    maxAmountCents: row.maxAmountCents,
    setCategoryId: row.setCategoryId,
    setTitle: row.setTitle,
    setAmountCents: row.setAmountCents,
    setAccountId: row.setAccountId,
    appendNote: row.appendNote,
    addTagId: row.addTagId,
    markAsTransfer: row.markAsTransfer,
    setTransferAccountId: row.setTransferAccountId,
  };
}

export async function loadRuleContext(userId: string): Promise<RuleContext> {
  const [rules, history, hidden] = await Promise.all([
    prisma.transactionRule.findMany({ where: { userId }, orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    prisma.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        title: { not: null },
        splitParts: { none: {} },
      },
      select: { title: true, categoryId: true },
      orderBy: { date: "desc" },
      take: LEARNED_TITLE_HISTORY_LIMIT,
    }),
    prisma.hiddenTitleSuggestion.findMany({ where: { userId }, select: { titleKey: true } }),
  ]);
  return {
    rules: sortRules(rules.map(toTransactionRuleInput)),
    learned: buildExpenseTitleSuggestions(history),
    hiddenTitleKeys: hidden.map((h) => h.titleKey),
  };
}
