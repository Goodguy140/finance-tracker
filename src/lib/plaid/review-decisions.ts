import { CategoryKind, PlaidStagedStatus, TransactionType } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { LONG_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import {
  addStagedRow,
  applyBankRevision,
  COMMITTABLE_STAGED_SELECT,
  dismissBankRevision,
  ignoreStagedRow,
  linkStagedRow,
  loadStagedProposer,
  pairStagedRows,
  toCommittable,
  type PairOutcome,
  type ReviewOutcome,
  type ReviewRefusal,
} from "@/lib/plaid/review";
import { defaultStagedType, proposeStagedRowAs } from "@/lib/plaid/staged-rules";
import { emitTransactionsCreated } from "@/lib/webhooks";

/**
 * The bank review queue's decisions, whole: what the website's queue buttons and the phone
 * app's `/api/v1/review-queue` routes both call, so a row is booked the same way from either.
 * `review.ts` holds the writes; this adds what a person's decision needs around them (finding
 * the row, the rules' proposal, the category, ownership checks, webhooks and budget alerts).
 *
 * A decision that cannot be made throws `ReviewDecisionError` with the sentence to show; the
 * caller decides how (a form error on the website, a 409 for the app). Anything else thrown is
 * a real failure.
 */

export class ReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewDecisionError";
  }
}

/** The message a person sees when a review decision is refused. */
export const REVIEW_REFUSALS: Record<ReviewRefusal, string> = {
  "already-reviewed": "That synced transaction has already been reviewed.",
  "target-not-found": "The transaction to link to was not found.",
  "target-verified": "That transaction is already confirmed against another bank record.",
  "type-mismatch": "An expense cannot be linked to an income entry.",
  "not-a-pair":
    "Those two cannot be one transfer: they need the same amount leaving one account and arriving in another, a few days apart at most.",
};

const NOT_FOUND = "That synced transaction was not found.";

/** Throws inside a database transaction, so a refused decision rolls back everything with it. */
function orRefuse(outcome: ReviewOutcome): string;
function orRefuse(outcome: PairOutcome): [string, string];
/** Throws the refusal's message; otherwise the id (or a pair's two ids) of the entry it touched. */
function orRefuse(outcome: ReviewOutcome | PairOutcome): string | [string, string] {
  if (!outcome.ok) throw new ReviewDecisionError(REVIEW_REFUSALS[outcome.reason]);
  return "transactionIds" in outcome ? outcome.transactionIds : outcome.transactionId;
}

/** Expense, income or transfer from a form or request value; null for anything else. */
export function parseCountAs(value: unknown): TransactionType | null {
  return value === TransactionType.EXPENSE || value === TransactionType.INCOME || value === TransactionType.TRANSFER
    ? value
    : null;
}

async function assertOwnsAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!account) throw new ReviewDecisionError("Selected account was not found.");
}

async function assertOwnsCategory(userId: string, categoryId: string, kind: CategoryKind) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId, kind }, select: { id: true } });
  if (!category) throw new ReviewDecisionError("Selected category was not found.");
}

const DECIDABLE_SELECT = {
  ...COMMITTABLE_STAGED_SELECT,
  status: true,
  name: true,
  merchantName: true,
  suggestedCategoryId: true,
} as const;

export type StagedDecision =
  | { decision: "ignore" }
  | { decision: "link"; transactionId: string }
  /** `countAs` books it as something other than the sync guessed; `categoryId` overrides the proposal's. */
  | { decision: "add"; countAs?: TransactionType | null; categoryId?: string | null };

/**
 * Commits one reviewed row: link it to a transaction the user already entered, add it as a new
 * one, or ignore it. Returns the transaction it was booked as, or null when ignored.
 *
 * Not gated on a passkey. Linking a bank is a standing grant and is; approving a single
 * transaction is ordinary bookkeeping, and a prompt per row would make the queue unusable.
 */
export async function decideStagedRow(
  userId: string,
  stagedId: string,
  decision: StagedDecision,
): Promise<{ transactionId: string | null }> {
  const row = await prisma.plaidStagedTransaction.findFirst({
    where: { id: stagedId, userId },
    select: DECIDABLE_SELECT,
  });
  if (!row) throw new ReviewDecisionError(NOT_FOUND);
  // Answered early for a clearer message; the claim inside each decision is what enforces it.
  if (row.status !== PlaidStagedStatus.NEEDS_REVIEW) throw new ReviewDecisionError(REVIEW_REFUSALS["already-reviewed"]);
  const staged = toCommittable(row);

  if (decision.decision === "ignore") {
    if (!(await ignoreStagedRow(prisma, { userId, stagedId: staged.id }))) {
      throw new ReviewDecisionError(REVIEW_REFUSALS["already-reviewed"]);
    }
    return { transactionId: null };
  }

  let transactionId: string;
  if (decision.decision === "link") {
    transactionId = await prisma.$transaction(async (tx) =>
      orRefuse(await linkStagedRow(tx, { userId, staged, transactionId: decision.transactionId })),
    );
  } else {
    // The queue can book a row as a transfer or not, whatever the sync guessed.
    const type = decision.countAs ?? staged.type;
    const proposal = proposeStagedRowAs(await loadStagedProposer(userId), row, type);
    const resolvedCategoryId =
      type === TransactionType.TRANSFER
        ? await ensureFallbackCategoryFor(prisma, userId, CategoryKind.TRANSFER)
        : decision.categoryId || proposal.categoryId;
    if (!resolvedCategoryId) throw new ReviewDecisionError("Choose a category for this transaction.");
    await assertOwnsCategory(userId, resolvedCategoryId, type);
    if (staged.suggestedAccountId) await assertOwnsAccount(userId, staged.suggestedAccountId);
    // A rule's split is written only while the row keeps the category the split gave it.
    const kept = resolvedCategoryId === proposal.categoryId ? proposal : { ...proposal, split: null };
    transactionId = await prisma.$transaction(async (tx) =>
      orRefuse(await addStagedRow(tx, { userId, staged, categoryId: resolvedCategoryId, proposal: kept, type })),
    );
    emitTransactionsCreated(userId, [transactionId], "bank");
  }

  scheduleBudgetAlertEmails(userId);
  return { transactionId };
}

/**
 * Adds two bank rows as the two legs of one transfer: the money leaving one account and
 * arriving in the other, each kept out of every total and each naming the other's account.
 */
export async function pairStagedTransfers(userId: string, stagedId: string, peerStagedId: string): Promise<[string, string]> {
  if (!stagedId || !peerStagedId || stagedId === peerStagedId) {
    throw new ReviewDecisionError("Choose the two sides of the transfer.");
  }
  const stagedIds = [stagedId, peerStagedId];
  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: stagedIds }, userId },
    select: DECIDABLE_SELECT,
  });
  const ordered = stagedIds.map((id) => rows.find((row) => row.id === id));
  const [a, b] = ordered;
  if (!a || !b) throw new ReviewDecisionError(NOT_FOUND);
  if (a.status !== PlaidStagedStatus.NEEDS_REVIEW || b.status !== PlaidStagedStatus.NEEDS_REVIEW) {
    throw new ReviewDecisionError(REVIEW_REFUSALS["already-reviewed"]);
  }
  for (const row of ordered) {
    if (row?.suggestedAccountId) await assertOwnsAccount(userId, row.suggestedAccountId);
  }

  const propose = await loadStagedProposer(userId);
  const leg = (row: typeof a) => ({
    staged: toCommittable(row),
    proposal: proposeStagedRowAs(propose, row, TransactionType.TRANSFER),
  });
  const categoryId = await ensureFallbackCategoryFor(prisma, userId, CategoryKind.TRANSFER);
  const legIds = await prisma.$transaction(async (tx) =>
    orRefuse(await pairStagedRows(tx, { userId, legs: [leg(a), leg(b)], categoryId })),
  );
  emitTransactionsCreated(userId, legIds, "bank");
  return legIds;
}

/**
 * Adds several rows in one step: every unmatched row ("Add all"), or the rows ticked in the
 * queue. With `categoryId` ("Add with category") each row is booked as an expense or income in
 * that category, whatever the sync or a rule proposed; the rows must all be of that kind.
 * Returns how many were added; rows already decided are left out.
 */
export async function addStagedRows(userId: string, stagedIds: string[], chosenCategoryId: string | null): Promise<number> {
  if (stagedIds.length === 0) return 0;
  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: stagedIds }, userId, status: PlaidStagedStatus.NEEDS_REVIEW },
    select: { ...COMMITTABLE_STAGED_SELECT, name: true, merchantName: true, suggestedCategoryId: true },
  });

  const propose = await loadStagedProposer(userId);
  let chosenKind: CategoryKind | null = null;
  if (chosenCategoryId) {
    const category = await prisma.category.findFirst({ where: { id: chosenCategoryId, userId }, select: { kind: true } });
    if (!category || category.kind === CategoryKind.TRANSFER) {
      throw new ReviewDecisionError("Choose a category for these transactions.");
    }
    chosenKind = category.kind;
    const mismatched = rows.filter((row) => row.type !== chosenKind);
    if (mismatched.length > 0) {
      throw new ReviewDecisionError(
        `${mismatched.length} of these ${chosenKind === CategoryKind.INCOME ? "are not income" : "are not spending"}, so they can't go in that category. Untick them, or add them on their own.`,
      );
    }
  }
  // Each row as the queue offers it: a rule that marks transfers books its rows as transfers,
  // as the row's ticked "transfer" box would. A chosen category books them as what they are.
  const plans = new Map(
    rows.map((row) => {
      const type = chosenKind ? row.type : defaultStagedType(propose, row);
      return [row.id, { type, proposal: proposeStagedRowAs(propose, row, type) }];
    }),
  );
  // A row a rule turned into a transfer has no category of the right kind from the sync.
  const retyped = (row: (typeof rows)[number]) => plans.get(row.id)!.type !== row.type;
  const transferCategoryId = rows.some(retyped)
    ? await ensureFallbackCategoryFor(prisma, userId, CategoryKind.TRANSFER)
    : null;
  const categoryFor = (row: (typeof rows)[number]) =>
    chosenCategoryId ?? (retyped(row) ? transferCategoryId : plans.get(row.id)!.proposal.categoryId);

  // A row with no suggested category cannot be written -- Transaction.categoryId is
  // non-nullable. Refusing the batch beats silently adding fewer rows than the button
  // promised, which is invisible to the person who pressed it.
  const uncategorised = rows.filter((row) => !categoryFor(row));
  if (uncategorised.length > 0) {
    throw new ReviewDecisionError(
      `${uncategorised.length} of these have no category yet. Open each one and pick a category, or add them individually.`,
    );
  }

  // For the same reason, a row someone else reviewed in the meantime refuses the whole batch
  // rather than quietly shrinking it.
  const addedIds = await prisma.$transaction(async (tx) => {
    const added: string[] = [];
    for (const row of rows) {
      const { type, proposal } = plans.get(row.id)!;
      added.push(
        orRefuse(
          await addStagedRow(tx, {
            userId,
            staged: toCommittable(row),
            categoryId: categoryFor(row)!,
            // "Add with category" books each row whole in that category, as it says.
            proposal: chosenCategoryId ? { ...proposal, split: null } : proposal,
            type,
          }),
        ),
      );
    }
    return added;
  }, LONG_TRANSACTION_OPTIONS);
  emitTransactionsCreated(userId, addedIds, "bank");
  scheduleBudgetAlertEmails(userId);
  return addedIds.length;
}

/** Ignores the rows ticked in the queue. Rows someone already decided are left as they are. */
export async function ignoreStagedRows(userId: string, stagedIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const stagedId of stagedIds) await ignoreStagedRow(tx, { userId, stagedId });
  });
}

/**
 * Links each row to the entry the matcher paired it with ("Link all strong matches").
 * `linkStagedRow` checks each one again (ownership, type, an entry already verified), and one
 * refusal rolls the whole batch back.
 */
export async function linkStagedRows(userId: string, pairs: { stagedId: string; transactionId: string }[]): Promise<void> {
  if (pairs.length === 0) return;
  if (new Set(pairs.map((p) => p.transactionId)).size !== pairs.length) {
    throw new ReviewDecisionError("Two bank rows matched the same entry. Link those one at a time.");
  }
  const rows = await prisma.plaidStagedTransaction.findMany({
    where: { id: { in: pairs.map((p) => p.stagedId) }, userId },
    select: COMMITTABLE_STAGED_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, toCommittable(row)]));
  await prisma.$transaction(async (tx) => {
    for (const pair of pairs) {
      const staged = byId.get(pair.stagedId);
      if (!staged) throw new ReviewDecisionError(NOT_FOUND);
      orRefuse(await linkStagedRow(tx, { userId, staged, transactionId: pair.transactionId }));
    }
  }, LONG_TRANSACTION_OPTIONS);
}

/** Applies the bank's revised values to a transaction the user already committed. */
export async function applyStagedRevision(userId: string, stagedId: string): Promise<void> {
  const applied = await prisma.$transaction((tx) => applyBankRevision(tx, { userId, stagedId }));
  if (!applied) throw new ReviewDecisionError("That revision was not found.");
  scheduleBudgetAlertEmails(userId);
}

/** Dismisses a revision, keeping what the user originally approved. */
export async function dismissStagedRevision(userId: string, stagedId: string): Promise<void> {
  if (!(await dismissBankRevision(prisma, { userId, stagedId }))) {
    throw new ReviewDecisionError("That revision was not found.");
  }
}
