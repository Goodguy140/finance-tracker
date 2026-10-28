import { resolveDisplayName } from "@/lib/plaid/ingest";
import {
  resolveRuleOutcome,
  type LearnedRuleContext,
  type RuleSplitShare,
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
  /** A rule says this is a transfer: the queue ticks "transfer" for it, and bulk add books it so. */
  markAsTransfer: boolean;
  /** The other side a rule names, written when the row is booked as a transfer. */
  transferAccountId: string | null;
  /**
   * The shares a rule splits this expense into; `categoryId` is then its first line's. Only
   * written while the row is booked in that category: picking another one in the queue, or
   * "Add with category", books it whole.
   */
  split: RuleSplitShare[] | null;
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
 * waits for a person, as every synced row does. A rule that marks transfers only changes what
 * the queue offers by default; the person can still untick it.
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
  const changed =
    outcome.title !== undefined ||
    outcome.appendNote !== undefined ||
    outcome.tagIds.length > 0 ||
    // Only when booked as a transfer: unticked, the rule's mark is not what gets written.
    (staged.type === "TRANSFER" && outcome.markAsTransfer !== undefined);
  return {
    title: outcome.title ?? displayName,
    categoryId: outcome.categoryId ?? staged.suggestedCategoryId,
    note: outcome.appendNote ?? null,
    tagIds: outcome.tagIds,
    markAsTransfer: outcome.markAsTransfer === true,
    transferAccountId: outcome.transferAccountId ?? null,
    split: outcome.split ?? null,
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

/**
 * The proposal for a staged row booked as `type`, which need not be the type the sync
 * guessed: the queue lets a person tick or untick "transfer". The sync's category belongs to
 * the type it guessed, so it is dropped when the type changes and the rules (or the
 * category picker) fill it instead. The dashboard shows this and the commit writes it.
 */
export function proposeStagedRowAs(
  propose: (staged: StagedRuleInput) => StagedRuleProposal,
  staged: StagedRuleInput,
  type: RuleTransactionType,
): StagedRuleProposal {
  return propose({
    ...staged,
    type,
    suggestedCategoryId: type === staged.type ? staged.suggestedCategoryId : null,
  });
}

/**
 * The type the queue offers a staged row as: a transfer if the sync filed it as one or a rule
 * marks it, otherwise the sync's own type. Rules are asked about the row as the sync typed it.
 */
export function defaultStagedType(
  propose: (staged: StagedRuleInput) => StagedRuleProposal,
  staged: StagedRuleInput,
): RuleTransactionType {
  if (staged.type === "TRANSFER") return "TRANSFER";
  return propose(staged).markAsTransfer ? "TRANSFER" : staged.type;
}
