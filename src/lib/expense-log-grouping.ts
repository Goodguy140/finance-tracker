import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";

export type GroupableExpenseEntry = {
  id: string;
  title: string | null;
  dateYmd: string;
  accountId: string | null;
  accountLabel: string;
  amountCents: number;
  preCreditCents: number | null;
  creditCents: number | null;
  categoryLabel: string;
  isSplit: boolean;
};

export type ExpenseLogGroup<T> = { key: string; entries: T[] };

export type ExpenseGroupSummary = {
  count: number;
  amountCents: number;
  /** Sum of receipt totals (falling back to the paid amount); null when no entry has one. */
  preCreditCents: number | null;
  creditCents: number;
  categoryLabels: string[];
  anySplit: boolean;
};

/**
 * Key for consolidating same-day repeats of the same purchase.
 * Returns null when the entry must stand on its own — untitled entries never
 * merge, because their heading falls back to the category name.
 */
export function expenseLogGroupKey(
  entry: Pick<GroupableExpenseEntry, "title" | "dateYmd" | "accountId" | "accountLabel">,
): string | null {
  const title = normalizeExpenseTitleKey(entry.title ?? "");
  if (!title) return null;
  const account = entry.accountId ?? `label:${entry.accountLabel}`;
  return `${entry.dateYmd}|${title}|${account}`;
}

/** Groups entries by {@link expenseLogGroupKey}; each group sits where its first member was. */
export function groupExpenseLogEntries<T extends GroupableExpenseEntry>(
  entries: T[],
): ExpenseLogGroup<T>[] {
  const groups: ExpenseLogGroup<T>[] = [];
  const byKey = new Map<string, ExpenseLogGroup<T>>();
  for (const entry of entries) {
    const key = expenseLogGroupKey(entry);
    if (key === null) {
      groups.push({ key: `ungrouped:${entry.id}`, entries: [entry] });
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const group: ExpenseLogGroup<T> = { key, entries: [entry] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

export function summarizeExpenseGroup(entries: GroupableExpenseEntry[]): ExpenseGroupSummary {
  const categoryLabels: string[] = [];
  let amountCents = 0;
  let preCreditCents = 0;
  let hasPreCredit = false;
  let creditCents = 0;
  let anySplit = false;

  for (const entry of entries) {
    amountCents += entry.amountCents;
    if (entry.preCreditCents != null && entry.preCreditCents > 0) {
      hasPreCredit = true;
      preCreditCents += entry.preCreditCents;
    } else {
      preCreditCents += entry.amountCents;
    }
    creditCents += entry.creditCents ?? 0;
    if (entry.isSplit) anySplit = true;
    if (!categoryLabels.includes(entry.categoryLabel)) categoryLabels.push(entry.categoryLabel);
  }

  return {
    count: entries.length,
    amountCents,
    preCreditCents: hasPreCredit ? preCreditCents : null,
    creditCents,
    categoryLabels,
    anySplit,
  };
}
