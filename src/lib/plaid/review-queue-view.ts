import { CategoryKind, PlaidStagedStatus, TransactionType, type Prisma, type PrismaClient } from "@prisma/client";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { paidCentsOf } from "@/lib/owed-shares";
import { catchAllCategoryId } from "@/lib/plaid/category-map";
import { resolveDisplayName } from "@/lib/plaid/ingest";
import { makeStagedProposer, proposeStagedRowAs, type StagedRuleProposal } from "@/lib/plaid/staged-rules";
import { assignTransferPairs } from "@/lib/plaid/transfer-pairing";
import { listTags } from "@/lib/tags-server";
import { describeRuleSplit, type RuleTransactionType } from "@/lib/transaction-rules";
import { loadRuleContext, type RuleContext } from "@/lib/transaction-rules-server";
import { outflowCents, untransferredType } from "@/lib/transfer-type";

/**
 * The bank review queue as a person sees it: each waiting row with what adding it would write
 * (both as a transfer and not), the entry the matcher would link it to, and the other bank row
 * it could pair with as one transfer; plus the bank's revisions to rows already committed.
 *
 * The dashboard builds these from what it has already loaded for the period on screen; the
 * phone app's `GET /api/v1/review-queue` loads them with `loadReviewQueue`. Both go through
 * `buildReviewRows`, so a row offers the same thing in either place.
 */

export type ReviewCandidate = {
  id: string;
  title: string;
  amountCents: number;
  dateYmd: string;
  dateDisplay: string;
};

/** What adding a row would write, as the user's rules shape it. */
export type ReviewProposal = {
  title: string;
  note: string | null;
  tagNames: string[];
  /** A rule's split, described ("70% Groceries, 30% Household"), kept only in its category. */
  split: string | null;
  /** Why the title/category differ from the bank's own: one of the user's rules, or a
   * category learned from a past entry with the same title. */
  reason: "rule" | "learned" | null;
};

export type ReviewRow = {
  id: string;
  institutionName: string;
  /** The title as the sync typed the row, for labelling it. */
  heading: string;
  /** The bank's own name for it, before any rule renamed it. */
  bankName: string;
  /** What adding it writes when booked as a transfer, and when not. */
  asTransfer: ReviewProposal;
  asNonTransfer: ReviewProposal;
  amountCents: number;
  /** The money arrived in the account (income, a refund, a transfer in) rather than left it. */
  moneyIn: boolean;
  /** The sync took it for money moving between the user's own accounts. */
  isTransfer: boolean;
  dateYmd: string;
  dateDisplay: string;
  accountLabel: string;
  /** What the row is booked as when it is not a transfer, and that type's categories. */
  nonTransferType: "EXPENSE" | "INCOME";
  categoryOptions: { id: string; name: string }[];
  suggestedCategoryId: string;
  isPending: boolean;
  /** Proposed link, when the matcher found a plausible one. */
  match: { candidate: ReviewCandidate; tier: "high" | "low"; reasons: string[] } | null;
  /** Another bank row that looks like the other side of the same transfer. */
  transferPair: {
    stagedId: string;
    heading: string;
    accountLabel: string;
    dateYmd: string;
    dateDisplay: string;
    /** The money left this row's account (and arrived in the other's). */
    outflow: boolean;
  } | null;
};

export type RevisionRow = {
  id: string;
  heading: string;
  institutionName: string;
  approvedAmountCents: number;
  bankAmountCents: number;
  bankDateYmd: string;
  bankDateDisplay: string;
};

/** How queue rows are read, for `buildReviewRows`. */
export const REVIEW_QUEUE_ROW_INCLUDE = {
  plaidItem: { select: { institutionName: true } },
} satisfies Prisma.PlaidStagedTransactionInclude;

export const REVIEW_QUEUE_ORDER: Prisma.PlaidStagedTransactionOrderByWithRelationInput[] = [
  { date: "desc" },
  { name: "asc" },
  { id: "asc" },
];

/** What transfer pairing needs of every waiting row (`assignTransferPairs`). */
export const PAIRING_POOL_SELECT = {
  id: true,
  suggestedAccountId: true,
  type: true,
  amountCents: true,
  date: true,
  postedDate: true,
  name: true,
  merchantName: true,
  suggestedCategoryId: true,
} satisfies Prisma.PlaidStagedTransactionSelect;

/** How many revisions the queue shows at once. */
export const REVISION_LIMIT = 50;

type QueueRow = Prisma.PlaidStagedTransactionGetPayload<{ include: typeof REVIEW_QUEUE_ROW_INCLUDE }>;
type PairingPoolRow = Prisma.PlaidStagedTransactionGetPayload<{ select: typeof PAIRING_POOL_SELECT }>;
type Candidate = { id: string; title: string | null; amountCents: number; date: Date };
type RevisionTarget = { id: string; amountCents: number; owedShares: { amountCents: number }[] };

type Db = Pick<PrismaClient, "transaction">;

/** The entries the matcher proposed for these rows, by id. */
export async function loadMatchCandidates(db: Db, userId: string, rows: { matchTransactionId: string | null }[]) {
  const ids = rows.map((row) => row.matchTransactionId).filter((id): id is string => Boolean(id));
  const found = ids.length
    ? await db.transaction.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, title: true, amountCents: true, date: true },
      })
    : [];
  return new Map<string, Candidate>(found.map((row) => [row.id, row]));
}

/** The committed entries these revisions would change, by id. */
export async function loadRevisionTargets(db: Db, userId: string, rows: { resolvedTransactionId: string | null }[]) {
  const ids = rows.map((row) => row.resolvedTransactionId).filter((id): id is string => Boolean(id));
  const found = ids.length
    ? await db.transaction.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, amountCents: true, owedShares: { select: { amountCents: true } } },
      })
    : [];
  return new Map<string, RevisionTarget>(found.map((row) => [row.id, row]));
}

function categoryOptionsOf(categories: readonly { id: string; name: string; kind: CategoryKind }[], kind: CategoryKind) {
  return categories.filter((c) => c.kind === kind).map((c) => ({ id: c.id, name: c.name }));
}

export function buildReviewRows(input: {
  stagedRows: QueueRow[];
  /** Every waiting row that could be the other side of a transfer, shown or not. */
  pairingPool: PairingPoolRow[];
  matchCandidates: ReadonlyMap<string, Candidate>;
  categories: readonly { id: string; name: string; kind: CategoryKind }[];
  /** The accounts rows are labelled with; a row on any other shows as unmapped. */
  accounts: readonly { id: string; name: string }[];
  ruleContext: RuleContext;
  tagNameById: ReadonlyMap<string, string>;
}): ReviewRow[] {
  const { categories, accounts } = input;
  const categoryKindById = new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType]));
  const expenseOptions = categoryOptionsOf(categories, CategoryKind.EXPENSE);
  const incomeOptions = categoryOptionsOf(categories, CategoryKind.INCOME);

  const propose = makeStagedProposer(input.ruleContext, categoryKindById);
  const proposalView = (proposal: StagedRuleProposal): ReviewProposal => ({
    title: proposal.title,
    note: proposal.note,
    tagNames: proposal.tagIds.flatMap((id) => input.tagNameById.get(id) ?? []),
    split: proposal.split
      ? describeRuleSplit(proposal.split, (id) => categories.find((c) => c.id === id)?.name ?? "Deleted category")
      : null,
    reason: proposal.reason,
  });
  const transferPairs = assignTransferPairs(input.pairingPool.map((row) => ({ ...row, accountId: row.suggestedAccountId })));
  const poolById = new Map(input.pairingPool.map((row) => [row.id, row]));
  const accountLabel = (accountId: string | null) => accounts.find((a) => a.id === accountId)?.name ?? "Unmapped account";

  return input.stagedRows.map((row) => {
    const isTransfer = row.type === TransactionType.TRANSFER;
    // What the row becomes if the user unticks "transfer" (or never ticks it): its own type,
    // or for a transfer, spending if the money left and income if it arrived.
    const nonTransferType = isTransfer ? untransferredType(row.amountCents) : row.type;
    // Both ways the row can be booked, each exactly as the commit will write it, so ticking
    // or unticking "transfer" shows what the rules do for that choice.
    const transferProposal = proposeStagedRowAs(propose, row, TransactionType.TRANSFER);
    const nonTransferProposal = proposeStagedRowAs(propose, row, nonTransferType);
    // A rule that marks transfers ticks "transfer" for a row the sync filed as spending or income.
    const offeredAsTransfer = isTransfer || nonTransferProposal.markAsTransfer;
    const proposal = offeredAsTransfer ? transferProposal : nonTransferProposal;
    const categoryOptions = nonTransferType === TransactionType.INCOME ? incomeOptions : expenseOptions;
    const candidate = row.matchTransactionId ? input.matchCandidates.get(row.matchTransactionId) : undefined;
    const reasons = row.matchReasonsJson ? (JSON.parse(row.matchReasonsJson) as string[]) : [];
    const peer = poolById.get(transferPairs.get(row.id) ?? "");
    const outflow = outflowCents(row.type, row.amountCents);
    return {
      id: row.id,
      institutionName: row.plaidItem.institutionName ?? "Your bank",
      heading: proposal.title,
      bankName: resolveDisplayName(row.name, row.merchantName),
      asTransfer: proposalView(transferProposal),
      asNonTransfer: proposalView(nonTransferProposal),
      amountCents: row.amountCents,
      moneyIn: outflow < 0,
      isTransfer: offeredAsTransfer,
      dateYmd: ymdFromDateUtc(row.date),
      dateDisplay: formatDateOnlyUtc(row.date),
      accountLabel: accountLabel(row.suggestedAccountId),
      transferPair: peer
        ? {
            stagedId: peer.id,
            // Pairing books both legs as transfers, so the peer is named as one.
            heading: proposeStagedRowAs(propose, peer, TransactionType.TRANSFER).title,
            accountLabel: accountLabel(peer.suggestedAccountId),
            dateYmd: ymdFromDateUtc(peer.date),
            dateDisplay: formatDateOnlyUtc(peer.date),
            // Which way the money went, from this row's side.
            outflow: outflow > 0,
          }
        : null,
      nonTransferType: nonTransferType === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const),
      categoryOptions,
      suggestedCategoryId:
        nonTransferProposal.categoryId ?? catchAllCategoryId(categoryOptions) ?? categoryOptions[0]?.id ?? "",
      isPending: row.isPending,
      match:
        candidate && row.matchTier
          ? {
              candidate: {
                id: candidate.id,
                title: candidate.title ?? "Untitled",
                amountCents: candidate.amountCents,
                dateYmd: ymdFromDateUtc(candidate.date),
                dateDisplay: formatDateOnlyUtc(candidate.date),
              },
              tier: row.matchTier === "high" ? ("high" as const) : ("low" as const),
              reasons,
            }
          : null,
    };
  });
}

export function buildRevisionRows(revisedRows: QueueRow[], targets: ReadonlyMap<string, RevisionTarget>): RevisionRow[] {
  return revisedRows.flatMap((row) => {
    const target = row.resolvedTransactionId ? targets.get(row.resolvedTransactionId) : undefined;
    // Same amount on both sides: nothing to choose between. Sync no longer raises these, but
    // a row can still get here if the user edited their entry to the bank's amount after the
    // flag was raised, and rows flagged before sync stopped raising them still carry it.
    // What the user paid, like the bank's figure: what others owe was taken out of the amount.
    if (!target || paidCentsOf(target) === row.amountCents) return [];
    return [
      {
        id: row.id,
        heading: resolveDisplayName(row.name, row.merchantName),
        institutionName: row.plaidItem.institutionName ?? "Your bank",
        approvedAmountCents: paidCentsOf(target),
        bankAmountCents: row.amountCents,
        bankDateYmd: ymdFromDateUtc(row.date),
        bankDateDisplay: formatDateOnlyUtc(row.date),
      },
    ];
  });
}

export type ReviewQueue = {
  rows: ReviewRow[];
  /** Every waiting row, including those past `limit`. */
  total: number;
  revisions: RevisionRow[];
  /** The categories a row can be added in, by the type it is booked as (`nonTransferType`). */
  categories: { expense: { id: string; name: string }[]; income: { id: string; name: string }[] };
};

/**
 * The whole queue, every period at once, newest first: what the phone app shows. `limit` caps
 * the rows built; `total` counts them all.
 */
export async function loadReviewQueue(db: PrismaClient, userId: string, limit: number): Promise<ReviewQueue> {
  const waiting = { userId, status: PlaidStagedStatus.NEEDS_REVIEW };
  const [stagedRows, total, revisedRows, pairingPool, categories, accounts, ruleContext, tags] = await Promise.all([
    db.plaidStagedTransaction.findMany({
      where: waiting,
      include: REVIEW_QUEUE_ROW_INCLUDE,
      orderBy: REVIEW_QUEUE_ORDER,
      take: limit,
    }),
    db.plaidStagedTransaction.count({ where: waiting }),
    db.plaidStagedTransaction.findMany({
      where: { userId, revisedAfterResolveAt: { not: null } },
      include: REVIEW_QUEUE_ROW_INCLUDE,
      orderBy: { revisedAfterResolveAt: "desc" },
      take: REVISION_LIMIT,
    }),
    db.plaidStagedTransaction.findMany({ where: waiting, select: PAIRING_POOL_SELECT }),
    db.category.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    db.account.findMany({ where: { userId, archived: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    loadRuleContext(userId),
    listTags(db, userId),
  ]);
  const [matchCandidates, revisionTargets] = await Promise.all([
    loadMatchCandidates(db, userId, stagedRows),
    loadRevisionTargets(db, userId, revisedRows),
  ]);
  return {
    rows: buildReviewRows({
      stagedRows,
      pairingPool,
      matchCandidates,
      categories,
      accounts,
      ruleContext,
      tagNameById: new Map(tags.map((tag) => [tag.id, tag.name])),
    }),
    total,
    revisions: buildRevisionRows(revisedRows, revisionTargets),
    categories: {
      expense: categoryOptionsOf(categories, CategoryKind.EXPENSE),
      income: categoryOptionsOf(categories, CategoryKind.INCOME),
    },
  };
}
