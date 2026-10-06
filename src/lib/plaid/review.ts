import { PlaidStagedStatus, TransactionType, type Prisma } from "@prisma/client";
import { ownPartCents } from "@/lib/owed-shares";
import { prisma } from "@/lib/prisma";
import { makeStagedProposer, type StagedRuleProposal } from "@/lib/plaid/staged-rules";
import type { RuleTransactionType } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { transferPairDateDelta } from "@/lib/plaid/transfer-pairing";
import { addTagsToTransaction } from "@/lib/tags-server";
import { convertAmountCents } from "@/lib/transfer-type";

/**
 * Every write a review decision makes on a synced bank row: link it to a transaction the
 * user already entered, add it as a new one, add it and another row as the two legs of one
 * transfer, ignore it, or settle a revision the bank sent after it was committed.
 *
 * The review queue's buttons and the sync's auto-link both come through here, so "linked"
 * means one thing wherever it happens: a verification row, the bank's posted date only when
 * the user's entry had none, and the staged row pointing at the transaction.
 *
 * Each decision starts by *claiming* the staged row: a conditional update that only succeeds
 * while it is still NEEDS_REVIEW. Two submits of the same row (a double click, two tabs, the
 * sync racing a person) therefore cannot both commit it; the second sees `already-reviewed`
 * and writes nothing. Checking the status with a read first and updating afterwards, as this
 * code used to, left a gap between the two in which both could pass.
 *
 * Nothing here decides what to tell anyone. Callers map an outcome to an error message, an
 * audit row, or (for the sync) a silent skip.
 */

type Tx = Prisma.TransactionClient;

/** What a decision needs to know about the staged row it commits. */
export type CommittableStagedRow = {
  id: string;
  plaidTransactionId: string;
  plaidItemId: string;
  plaidAccountRowId: string;
  institutionName: string | null;
  type: TransactionType;
  amountCents: number;
  date: Date;
  postedDate: Date | null;
  suggestedAccountId: string | null;
};

export type ReviewRefusal =
  /** Someone (or the sync) decided this row first. */
  | "already-reviewed"
  | "target-not-found"
  /** The transaction is already confirmed against another bank record. */
  | "target-verified"
  /** An expense row cannot back an income entry, or the other way round. */
  | "type-mismatch"
  /** The two rows cannot be the two sides of one transfer (`transferPairDateDelta`). */
  | "not-a-pair";

export type ReviewOutcome = { ok: true; transactionId: string } | { ok: false; reason: ReviewRefusal };

export type PairOutcome =
  | { ok: true; transactionIds: [string, string] }
  | { ok: false; reason: ReviewRefusal };

/** The select that produces a `CommittableStagedRow`, with `toCommittable`. */
export const COMMITTABLE_STAGED_SELECT = {
  id: true,
  plaidTransactionId: true,
  plaidAccountRowId: true,
  type: true,
  amountCents: true,
  date: true,
  postedDate: true,
  suggestedAccountId: true,
  plaidItem: { select: { id: true, institutionName: true } },
} satisfies Prisma.PlaidStagedTransactionSelect;

export function toCommittable(
  row: Prisma.PlaidStagedTransactionGetPayload<{ select: typeof COMMITTABLE_STAGED_SELECT }>,
): CommittableStagedRow {
  return {
    id: row.id,
    plaidTransactionId: row.plaidTransactionId,
    plaidItemId: row.plaidItem.id,
    plaidAccountRowId: row.plaidAccountRowId,
    institutionName: row.plaidItem.institutionName,
    type: row.type,
    amountCents: row.amountCents,
    date: row.date,
    postedDate: row.postedDate,
    suggestedAccountId: row.suggestedAccountId,
  };
}

/** Moves a still-unreviewed row to its decision. False when it was already decided. */
async function claim(
  tx: Tx,
  userId: string,
  stagedId: string,
  status: PlaidStagedStatus,
  resolvedTransactionId: string | null,
): Promise<boolean> {
  const claimed = await tx.plaidStagedTransaction.updateMany({
    where: { id: stagedId, userId, status: PlaidStagedStatus.NEEDS_REVIEW },
    data: { status, resolvedTransactionId, resolvedAt: new Date() },
  });
  return claimed.count === 1;
}

async function verify(
  tx: Tx,
  userId: string,
  staged: CommittableStagedRow,
  transactionId: string,
  source: "MATCHED" | "IMPORTED",
): Promise<void> {
  await tx.transactionVerification.create({
    data: {
      userId,
      transactionId,
      source,
      plaidTransactionId: staged.plaidTransactionId,
      plaidItemId: staged.plaidItemId,
      plaidAccountRowId: staged.plaidAccountRowId,
      institutionName: staged.institutionName,
    },
  });
}

/**
 * Confirms a transaction the user entered against this bank row. The amount, category and
 * title the user chose are left exactly as they are; the bank's posted date fills in only
 * when the entry had none, because it is better information than none.
 */
export async function linkStagedRow(
  tx: Tx,
  input: { userId: string; staged: CommittableStagedRow; transactionId: string },
): Promise<ReviewOutcome> {
  const { userId, staged } = input;
  const target = await tx.transaction.findFirst({
    where: { id: input.transactionId, userId },
    select: { id: true, type: true, postedDate: true, verification: { select: { id: true } } },
  });
  if (!target) return { ok: false, reason: "target-not-found" };
  if (target.verification) return { ok: false, reason: "target-verified" };
  if (target.type !== staged.type) return { ok: false, reason: "type-mismatch" };

  if (!(await claim(tx, userId, staged.id, PlaidStagedStatus.LINKED, target.id))) {
    return { ok: false, reason: "already-reviewed" };
  }
  await verify(tx, userId, staged, target.id, "MATCHED");
  if (!target.postedDate) {
    await tx.transaction.update({
      where: { id: target.id },
      data: { postedDate: staged.postedDate ?? staged.date },
    });
  }
  return { ok: true, transactionId: target.id };
}

/** What a commit takes from the queue's proposal. Tags are optional for callers that have none. */
type StagedProposalFields = Pick<StagedRuleProposal, "title" | "note"> & Partial<Pick<StagedRuleProposal, "tagIds">>;

/**
 * Adds this bank row to the log as a new transaction: the bank's account, amount and dates,
 * with the title, category, note and tags the queue proposed.
 *
 * `type` books it as something other than the sync guessed — a transfer the bank filed as a
 * purchase, or the reverse. The amount is the bank's either way, converted to the new type's
 * sign (`convertAmountCents`); the staged row keeps the bank's own view.
 */
export async function addStagedRow(
  tx: Tx,
  input: {
    userId: string;
    staged: CommittableStagedRow;
    categoryId: string;
    proposal: StagedProposalFields;
    type?: TransactionType;
  },
): Promise<ReviewOutcome> {
  const { userId, staged } = input;
  const type = input.type ?? staged.type;
  // Claimed before the transaction exists, so a losing double-submit creates nothing. The
  // resolved id is filled in below, inside the same database transaction.
  if (!(await claim(tx, userId, staged.id, PlaidStagedStatus.ADDED, null))) {
    return { ok: false, reason: "already-reviewed" };
  }
  const created = await tx.transaction.create({
    data: {
      userId,
      accountId: staged.suggestedAccountId,
      categoryId: input.categoryId,
      type,
      amountCents: convertAmountCents(staged.type, staged.amountCents, type),
      date: staged.date,
      postedDate: staged.postedDate,
      title: input.proposal.title,
      note: input.proposal.note,
    },
    select: { id: true },
  });
  await addTagsToTransaction(tx, created.id, input.proposal.tagIds ?? []);
  await verify(tx, userId, staged, created.id, "IMPORTED");
  await tx.plaidStagedTransaction.update({
    where: { id: staged.id },
    data: { resolvedTransactionId: created.id },
  });
  return { ok: true, transactionId: created.id };
}

/**
 * Adds two bank rows as the two legs of one transfer: each a transfer on its own account,
 * pointing at the other leg and naming the other's account as where the money went or came
 * from.
 *
 * Both are claimed, so a refusal on the second leg must roll the first back: callers run
 * this inside a database transaction and throw on `ok: false`, as with every decision here.
 */
export async function pairStagedRows(
  tx: Tx,
  input: {
    userId: string;
    legs: [
      { staged: CommittableStagedRow; proposal: StagedProposalFields },
      { staged: CommittableStagedRow; proposal: StagedProposalFields },
    ];
    /** The user's transfer category. */
    categoryId: string;
  },
): Promise<PairOutcome> {
  const [a, b] = input.legs;
  const pairable = (row: CommittableStagedRow) => ({ ...row, accountId: row.suggestedAccountId });
  if (transferPairDateDelta(pairable(a.staged), pairable(b.staged)) === null) {
    return { ok: false, reason: "not-a-pair" };
  }

  const added: string[] = [];
  for (const leg of input.legs) {
    const outcome = await addStagedRow(tx, {
      userId: input.userId,
      staged: leg.staged,
      categoryId: input.categoryId,
      proposal: leg.proposal,
      type: TransactionType.TRANSFER,
    });
    if (!outcome.ok) return outcome;
    added.push(outcome.transactionId);
  }
  const [aId, bId] = added;
  await tx.transaction.update({
    where: { id: aId },
    data: { transferAccountId: b.staged.suggestedAccountId, transferPeerId: bId },
  });
  await tx.transaction.update({
    where: { id: bId },
    data: { transferAccountId: a.staged.suggestedAccountId, transferPeerId: aId },
  });
  return { ok: true, transactionIds: [aId, bId] };
}

/** Dismisses a bank row without adding anything. False when it was already decided. */
export async function ignoreStagedRow(tx: Tx, input: { userId: string; stagedId: string }): Promise<boolean> {
  return claim(tx, input.userId, input.stagedId, PlaidStagedStatus.IGNORED, null);
}

/**
 * Takes the bank's revised amount and dates onto the transaction the row was committed as.
 * False when there is no such revision.
 *
 * The amount is converted to the transaction's type, which is not necessarily the staged
 * row's: income the user booked as a transfer keeps the transfer's sign.
 */
export async function applyBankRevision(tx: Tx, input: { userId: string; stagedId: string }): Promise<boolean> {
  const staged = await tx.plaidStagedTransaction.findFirst({
    where: { id: input.stagedId, userId: input.userId },
    select: { id: true, resolvedTransactionId: true, type: true, amountCents: true, date: true, postedDate: true },
  });
  if (!staged?.resolvedTransactionId) return false;
  const target = await tx.transaction.findFirst({
    where: { id: staged.resolvedTransactionId, userId: input.userId },
    select: { id: true, type: true, owedShares: { select: { amountCents: true } } },
  });
  if (target) {
    await tx.transaction.update({
      where: { id: target.id },
      data: {
        // The bank's figure is what was paid; what others owe stays out of the user's part.
        amountCents: ownPartCents(convertAmountCents(staged.type, staged.amountCents, target.type), target.owedShares),
        date: staged.date,
        postedDate: staged.postedDate,
      },
    });
  }
  await tx.plaidStagedTransaction.update({ where: { id: staged.id }, data: { revisedAfterResolveAt: null } });
  return true;
}

/** Keeps what the user originally approved and drops the revision prompt. */
export async function dismissBankRevision(tx: Tx, input: { userId: string; stagedId: string }): Promise<boolean> {
  const updated = await tx.plaidStagedTransaction.updateMany({
    where: { id: input.stagedId, userId: input.userId },
    data: { revisedAfterResolveAt: null },
  });
  return updated.count > 0;
}

/**
 * The queue's proposal function for one user, built from their current rules — the same one
 * the dashboard renders with, so what is committed is what the queue showed, and a category
 * that has since stopped belonging to the user is never written.
 */
export async function loadStagedProposer(userId: string) {
  const [context, categories] = await Promise.all([
    loadRuleContext(userId),
    prisma.category.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  return makeStagedProposer(context, new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType])));
}
