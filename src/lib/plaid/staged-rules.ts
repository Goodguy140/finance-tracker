import { resolveDisplayName } from "@/lib/plaid/ingest";
import {
  resolveRuleOutcome,
  type LearnedRuleContext,
  type RuleTransactionType,
  type TransactionRuleInput,
} from "@/lib/transaction-rules";

export type StagedRuleInput = {
  name: string;
  merchantName: string | null;
  amountCents: number;
  type: RuleTransactionType;
  suggestedAccountId: string | null;
  suggestedCategoryId: string | null;
};

export type StagedRuleProposal = {
  title: string;
  categoryId: string | null;
  note: string | null;
  /** Tags the rules add. */
  tagIds: string[];
  /** Why the proposal differs from the sync's own suggestion, for the queue to say so. */
  reason: "rule" | "learned" | null;
};

/**
 * What the review queue proposes for a staged bank row, and what committing it writes.
 *
 * Evaluated when the queue is read and again when a row is committed, rather than stored on
 * the staged row, so a rule added after a sync applies to rows already waiting. Rules and
 * learned combos replace the sync's category mapping and the display name; the account and
 * amount are the bank's and are never touched. Nothing here commits anything — the row still
 * waits for a person, as every synced row does.
 */
export function proposeForStagedRow(
  staged: StagedRuleInput,
  rules: readonly TransactionRuleInput[],
  categoryKindById: ReadonlyMap<string, RuleTransactionType>,
  learned: LearnedRuleContext,
): StagedRuleProposal {
  const displayName = resolveDisplayName(staged.name, staged.merchantName);
  const outcome = resolveRuleOutcome(
    rules,
    {
      texts: [displayName, staged.merchantName, staged.name],
      amountCents: staged.amountCents,
      accountId: staged.suggestedAccountId,
      type: staged.type,
    },
    categoryKindById,
    learned,
  );
  const changed = outcome.title !== undefined || outcome.appendNote !== undefined || outcome.tagIds.length > 0;
  return {
    title: outcome.title ?? displayName,
    categoryId: outcome.categoryId ?? staged.suggestedCategoryId,
    note: outcome.appendNote ?? null,
    tagIds: outcome.tagIds,
    reason: outcome.categoryFrom ?? (changed ? "rule" : null),
  };
}

/**
 * `proposeForStagedRow` bound to one user's rules, learned combos and category kinds — the
 * single way the dashboard and the commit both build it, so the two cannot drift apart.
 */
export function makeStagedProposer(
  context: { rules: readonly TransactionRuleInput[] } & LearnedRuleContext,
  categoryKindById: ReadonlyMap<string, RuleTransactionType>,
): (staged: StagedRuleInput) => StagedRuleProposal {
  const learned = { learned: context.learned, hiddenTitleKeys: context.hiddenTitleKeys };
  return (staged) => proposeForStagedRow(staged, context.rules, categoryKindById, learned);
}
