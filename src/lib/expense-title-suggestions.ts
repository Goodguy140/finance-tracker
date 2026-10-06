export type ExpenseTitleSuggestion = {
  title: string;
  categoryId: string;
};

export function normalizeExpenseTitleKey(title: string) {
  return title.trim().toLowerCase();
}

/** Most recent title per normalized key (rows should be newest-first). */
export function buildExpenseTitleSuggestions(
  rows: { title: string | null; categoryId: string }[],
): ExpenseTitleSuggestion[] {
  const seen = new Set<string>();
  const out: ExpenseTitleSuggestion[] = [];
  for (const row of rows) {
    const title = row.title?.trim();
    if (!title) continue;
    const key = normalizeExpenseTitleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, categoryId: row.categoryId });
  }
  return out;
}

export function categoryIdForExpenseTitle(
  suggestions: ExpenseTitleSuggestion[],
  title: string,
): string | undefined {
  const key = normalizeExpenseTitleKey(title);
  if (!key) return undefined;
  return suggestions.find((s) => normalizeExpenseTitleKey(s.title) === key)?.categoryId;
}

export function expenseLogMatchesQuery(
  entry: {
    title: string | null;
    note: string | null;
    categoryLabel: string;
    accountLabel: string;
    amountCents: number;
    tags?: readonly string[];
  },
  query: string,
  formatAmount: (cents: number) => string,
) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    entry.title,
    entry.note,
    entry.categoryLabel,
    entry.accountLabel,
    formatAmount(entry.amountCents),
    String((entry.amountCents / 100).toFixed(2)),
    ...(entry.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
