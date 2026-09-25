import {
  normalizeExpenseTitleKey,
  type ExpenseTitleSuggestion,
} from "@/lib/expense-title-suggestions";

/**
 * The transaction rules engine. Pure and client-safe: the manual forms and the Settings →
 * Rules tester run it in the browser, and CSV import, the Plaid review queue and "apply to
 * past transactions" run the same code on the server.
 *
 * Precedence, everywhere: a value the source states explicitly (what the user typed, a CSV
 * category column, the bank's account and amount) beats a rule, which beats a learned
 * Title → Category combo, which beats the caller's existing default.
 */

export type RuleTextOperator = "CONTAINS" | "EQUALS" | "STARTS_WITH";
export type RuleTransactionType = "EXPENSE" | "INCOME";

/** The serialisable rule shape — what the database row is mapped to and what clients get. */
export type TransactionRuleInput = {
  id: string;
  priority: number;
  enabled: boolean;
  titleOperator: RuleTextOperator;
  titlePattern: string;
  transactionType: RuleTransactionType | null;
  matchAccountId: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  setCategoryId: string | null;
  setTitle: string | null;
  setAmountCents: number | null;
  setAccountId: string | null;
  appendNote: string | null;
};

export type RuleSubject = {
  /** Every text the title condition may match: just the title, or a bank row's raw name,
   * merchant name and display name. A rule matches if any of them does. */
  texts: (string | null | undefined)[];
  /** NULL while a manual form's amount is still empty. */
  amountCents: number | null;
  accountId: string | null;
  type: RuleTransactionType;
};

export type RuleOutcome = {
  categoryId?: string;
  categoryFrom?: "rule" | "learned";
  title?: string;
  amountCents?: number;
  accountId?: string;
  appendNote?: string;
  /** Rules that contributed at least one field, in priority order. */
  ruleIds: string[];
};

export type LearnedRuleContext = {
  learned: ExpenseTitleSuggestion[];
  hiddenTitleKeys: ReadonlySet<string> | readonly string[];
};

export function textMatches(operator: RuleTextOperator, pattern: string, text: string) {
  const needle = normalizeExpenseTitleKey(pattern);
  const haystack = normalizeExpenseTitleKey(text);
  if (!needle || !haystack) return false;
  switch (operator) {
    case "EQUALS":
      return haystack === needle;
    case "STARTS_WITH":
      return haystack.startsWith(needle);
    case "CONTAINS":
      return haystack.includes(needle);
  }
}

export function ruleMatches(rule: TransactionRuleInput, subject: RuleSubject) {
  if (!rule.enabled) return false;
  if (rule.transactionType && rule.transactionType !== subject.type) return false;
  if (rule.matchAccountId && rule.matchAccountId !== subject.accountId) return false;
  if (rule.minAmountCents !== null || rule.maxAmountCents !== null) {
    if (subject.amountCents === null) return false;
    const amount = Math.abs(subject.amountCents);
    if (rule.minAmountCents !== null && amount < rule.minAmountCents) return false;
    if (rule.maxAmountCents !== null && amount > rule.maxAmountCents) return false;
  }
  return subject.texts.some((text) => !!text && textMatches(rule.titleOperator, rule.titlePattern, text));
}

export function sortRules<T extends Pick<TransactionRuleInput, "priority" | "id">>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/**
 * Walks the enabled rules in priority order; each field is filled by the first matching rule
 * that sets it, so a broad "contains AMZN → Shopping" rule and a narrower "contains AMZN, over
 * $100 → rename" rule compose. A category is only taken if its kind matches the subject's
 * type — `categoryKindById` is the caller's list of categories the user owns. If no rule set
 * a category, an expense falls back to the learned Title → Category combo unless it is hidden.
 */
export function resolveRuleOutcome(
  rules: readonly TransactionRuleInput[],
  subject: RuleSubject,
  categoryKindById: ReadonlyMap<string, RuleTransactionType>,
  learned?: LearnedRuleContext,
): RuleOutcome {
  const outcome: RuleOutcome = { ruleIds: [] };
  for (const rule of sortRules(rules)) {
    if (!ruleMatches(rule, subject)) continue;
    let contributed = false;
    if (
      outcome.categoryId === undefined &&
      rule.setCategoryId &&
      categoryKindById.get(rule.setCategoryId) === subject.type
    ) {
      outcome.categoryId = rule.setCategoryId;
      outcome.categoryFrom = "rule";
      contributed = true;
    }
    if (outcome.title === undefined && rule.setTitle?.trim()) {
      outcome.title = rule.setTitle.trim();
      contributed = true;
    }
    if (outcome.amountCents === undefined && rule.setAmountCents !== null) {
      outcome.amountCents = rule.setAmountCents;
      contributed = true;
    }
    if (outcome.accountId === undefined && rule.setAccountId) {
      outcome.accountId = rule.setAccountId;
      contributed = true;
    }
    if (outcome.appendNote === undefined && rule.appendNote?.trim()) {
      outcome.appendNote = rule.appendNote.trim();
      contributed = true;
    }
    if (contributed) outcome.ruleIds.push(rule.id);
  }

  if (outcome.categoryId === undefined && subject.type === "EXPENSE" && learned) {
    const categoryId = learnedCategoryFor(learned, subject.texts);
    if (categoryId && categoryKindById.get(categoryId) === "EXPENSE") {
      outcome.categoryId = categoryId;
      outcome.categoryFrom = "learned";
    }
  }
  return outcome;
}

function learnedCategoryFor(
  { learned, hiddenTitleKeys }: LearnedRuleContext,
  texts: RuleSubject["texts"],
): string | undefined {
  const hidden = hiddenTitleKeys instanceof Set ? hiddenTitleKeys : new Set(hiddenTitleKeys);
  const byKey = new Map(learned.map((s) => [normalizeExpenseTitleKey(s.title), s.categoryId]));
  for (const text of texts) {
    const key = text ? normalizeExpenseTitleKey(text) : "";
    if (!key || hidden.has(key)) continue;
    const categoryId = byKey.get(key);
    if (categoryId) return categoryId;
  }
  return undefined;
}

/** Learned combos minus the ones the user hid — what the forms and the Rules tab list. */
export function visibleLearnedSuggestions(
  learned: readonly ExpenseTitleSuggestion[],
  hiddenTitleKeys: readonly string[],
): ExpenseTitleSuggestion[] {
  const hidden = new Set(hiddenTitleKeys);
  return learned.filter((s) => !hidden.has(normalizeExpenseTitleKey(s.title)));
}

/** Appends a rule's note to an existing note without repeating it on a re-apply. */
export function appendRuleNote(existing: string | null | undefined, addition: string | undefined) {
  const base = existing?.trim() ?? "";
  if (!addition) return base || null;
  if (base.toLowerCase().includes(addition.toLowerCase())) return base;
  return base ? `${base}\n${addition}` : addition;
}

const OPERATOR_LABEL: Record<RuleTextOperator, string> = {
  CONTAINS: "contains",
  EQUALS: "is",
  STARTS_WITH: "starts with",
};

export function describeRuleCondition(
  rule: TransactionRuleInput,
  labels: { account: (id: string) => string; amount: (cents: number) => string },
) {
  const parts = [`Title ${OPERATOR_LABEL[rule.titleOperator]} “${rule.titlePattern}”`];
  if (rule.transactionType) parts.push(rule.transactionType === "EXPENSE" ? "expenses only" : "income only");
  if (rule.matchAccountId) parts.push(`on ${labels.account(rule.matchAccountId)}`);
  const { minAmountCents: min, maxAmountCents: max } = rule;
  if (min !== null && max !== null) {
    parts.push(min === max ? `amount ${labels.amount(min)}` : `amount ${labels.amount(min)}–${labels.amount(max)}`);
  } else if (min !== null) {
    parts.push(`amount ≥ ${labels.amount(min)}`);
  } else if (max !== null) {
    parts.push(`amount ≤ ${labels.amount(max)}`);
  }
  return parts.join(", ");
}

export function describeRuleActions(
  rule: TransactionRuleInput,
  labels: { category: (id: string) => string; account: (id: string) => string; amount: (cents: number) => string },
) {
  const parts: string[] = [];
  if (rule.setCategoryId) parts.push(`category → ${labels.category(rule.setCategoryId)}`);
  if (rule.setTitle) parts.push(`rename → “${rule.setTitle}”`);
  if (rule.setAmountCents !== null) parts.push(`amount → ${labels.amount(rule.setAmountCents)}`);
  if (rule.setAccountId) parts.push(`account → ${labels.account(rule.setAccountId)}`);
  if (rule.appendNote) parts.push(`note + “${rule.appendNote}”`);
  return parts.join(", ") || "no actions";
}

export type PastTransaction = {
  id: string;
  title: string | null;
  type: RuleTransactionType;
  amountCents: number;
  accountId: string | null;
  categoryId: string;
  note: string | null;
};

export type RuleChange = {
  id: string;
  before: Pick<PastTransaction, "title" | "categoryId" | "accountId" | "note">;
  after: Pick<PastTransaction, "title" | "categoryId" | "accountId" | "note">;
};

/**
 * What applying one rule to past transactions would change. The amount action is never
 * applied retroactively — a recorded amount is a fact about what was spent, a rule's amount
 * is only a default for new entries. Rows the rule matches but would leave identical are
 * omitted. Callers exclude split transactions, whose categories live in their parts.
 */
export function planRuleApplication(
  rule: TransactionRuleInput,
  rows: readonly PastTransaction[],
  categoryKindById: ReadonlyMap<string, RuleTransactionType>,
): RuleChange[] {
  const active = { ...rule, enabled: true };
  const changes: RuleChange[] = [];
  for (const row of rows) {
    const subject: RuleSubject = {
      texts: [row.title],
      amountCents: row.amountCents,
      accountId: row.accountId,
      type: row.type,
    };
    if (!ruleMatches(active, subject)) continue;
    const before = { title: row.title, categoryId: row.categoryId, accountId: row.accountId, note: row.note };
    const after = { ...before };
    if (active.setCategoryId && categoryKindById.get(active.setCategoryId) === row.type) {
      after.categoryId = active.setCategoryId;
    }
    if (active.setTitle?.trim()) after.title = active.setTitle.trim();
    if (active.setAccountId) after.accountId = active.setAccountId;
    if (active.appendNote?.trim()) after.note = appendRuleNote(row.note, active.appendNote.trim());
    if (
      after.categoryId !== before.categoryId ||
      after.title !== before.title ||
      after.accountId !== before.accountId ||
      (after.note ?? null) !== (before.note ?? null)
    ) {
      changes.push({ id: row.id, before, after });
    }
  }
  return changes;
}
