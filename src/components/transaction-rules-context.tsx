"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";
import {
  resolveRuleOutcome,
  type RuleOutcome,
  type RuleSubject,
  type RuleTransactionType,
  type TransactionRuleInput,
} from "@/lib/transaction-rules";
import type { TagOption } from "@/lib/tags";

/**
 * The user's enabled rules, for the manual add/edit forms. Provided once by the dashboard
 * rather than threaded through every form, dialog and sheet that renders a title field.
 */
export type FormRules = {
  rules: TransactionRuleInput[];
  categoryKinds: Record<string, RuleTransactionType>;
  /** The user's tags: suggestions for the tag fields, and names for the tags rules add. */
  tags: TagOption[];
};

const TransactionRulesContext = createContext<FormRules | null>(null);

export function TransactionRulesProvider({ value, children }: { value: FormRules; children: ReactNode }) {
  return <TransactionRulesContext.Provider value={value}>{children}</TransactionRulesContext.Provider>;
}

type Option = { id: string; name: string };

/**
 * Runs the rules engine for one manual form. `evaluate` returns the outcome and whether it
 * differs from the last one this form applied: callers only write a field when it does, so a
 * category the person picked by hand is not snapped back on every keystroke — only when a
 * different rule (or none) starts to apply.
 */
export function useRuleAutofill({
  type,
  categoryOptions,
  learned,
}: {
  type: RuleTransactionType;
  categoryOptions: Option[];
  /** Learned Title → Category combos (already stripped of hidden ones). Expenses only. */
  learned?: ExpenseTitleSuggestion[];
}) {
  const context = useContext(TransactionRulesContext);
  const kinds = useMemo(() => {
    const map = new Map<string, RuleTransactionType>(Object.entries(context?.categoryKinds ?? {}));
    // Outside the provider (or for a category created since load) the form's own options
    // are still known to be of this form's type.
    for (const option of categoryOptions) if (!map.has(option.id)) map.set(option.id, type);
    return map;
  }, [context, categoryOptions, type]);
  const lastKey = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<RuleOutcome | null>(null);

  function peek(subject: Omit<RuleSubject, "type">): RuleOutcome {
    return resolveRuleOutcome(
      context?.rules ?? [],
      { ...subject, type },
      kinds,
      learned ? { learned, hiddenTitleKeys: [] } : undefined,
    );
  }

  function evaluate(subject: Omit<RuleSubject, "type">) {
    const next = peek(subject);
    const key = JSON.stringify([next.categoryId, next.accountId, next.amountCents, next.appendNote, next.title, next.tagIds]);
    const fresh = key !== lastKey.current;
    lastKey.current = key;
    setOutcome(next);
    return { outcome: next, fresh };
  }

  return { evaluate, peek, outcome };
}

const NO_TAGS: TagOption[] = [];

/**
 * The user's tags: `names` for a tag field's suggestions, `namesFor` to turn the tag ids a
 * rule adds into what the field shows. Empty outside the dashboard.
 */
export function useTagOptions() {
  const tags = useContext(TransactionRulesContext)?.tags ?? NO_TAGS;
  return useMemo(
    () => ({
      names: tags.map((tag) => tag.name),
      namesFor: (ids: readonly string[]) => ids.flatMap((id) => tags.find((tag) => tag.id === id)?.name ?? []),
    }),
    [tags],
  );
}

export function RuleAutofillHint({ outcome }: { outcome: RuleOutcome | null }) {
  if (!outcome) return null;
  const byRule = outcome.ruleIds.length > 0;
  if (!byRule && outcome.categoryFrom !== "learned") return null;
  return (
    <p className="text-xs text-blue-200/80" data-testid="rule-autofill-hint">
      {byRule ? "Filled in by your rules." : "Category from a past entry with this title."}{" "}
      <Link href="/settings#rules" className="underline underline-offset-2 hover:text-blue-100">
        Manage rules
      </Link>
    </p>
  );
}
