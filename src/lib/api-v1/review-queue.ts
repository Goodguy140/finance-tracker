import { TransactionType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { describePlaidItemAttention } from "@/lib/plaid/attention";
import type { StagedDecision } from "@/lib/plaid/review-decisions";
import { loadReviewQueue, type ReviewProposal, type ReviewRow, type RevisionRow } from "@/lib/plaid/review-queue-view";

/**
 * The bank review queue as `/api/v1/review-queue` gives it to the phone app: the rows the
 * website's queue shows (built by the same `buildReviewRows`), every period at once, with the
 * user's banks and what each needs. The decisions themselves are `review-decisions.ts`, which
 * the website's buttons call too.
 */

/** How many waiting rows one read builds; `total` says how many there are in all. */
export const API_QUEUE_LIMIT = 200;

/** The most rows one bulk request may name. Matches the most a read returns. */
export const API_BULK_MAX = API_QUEUE_LIMIT;

const lower = (type: "EXPENSE" | "INCOME") => (type === "INCOME" ? ("income" as const) : ("expense" as const));

function serializeProposal(proposal: ReviewProposal) {
  return {
    title: proposal.title,
    note: proposal.note,
    tags: proposal.tagNames,
    split: proposal.split,
    reason: proposal.reason,
  };
}

export function serializeReviewRow(row: ReviewRow) {
  return {
    id: row.id,
    bank: row.institutionName,
    heading: row.heading,
    bankName: row.bankName,
    amountCents: row.amountCents,
    /** Which way the money went, since `amountCents` carries the sign of its type. */
    direction: row.moneyIn ? ("in" as const) : ("out" as const),
    date: row.dateYmd,
    account: row.accountLabel,
    pending: row.isPending,
    isTransfer: row.isTransfer,
    /** What it is booked as when not a transfer; its categories are `categories[type]`. */
    type: lower(row.nonTransferType),
    suggestedCategoryId: row.suggestedCategoryId || null,
    asTransfer: serializeProposal(row.asTransfer),
    asNonTransfer: serializeProposal(row.asNonTransfer),
    match: row.match
      ? {
          transaction: {
            id: row.match.candidate.id,
            title: row.match.candidate.title,
            amountCents: row.match.candidate.amountCents,
            date: row.match.candidate.dateYmd,
          },
          tier: row.match.tier,
          reasons: row.match.reasons,
        }
      : null,
    transferPair: row.transferPair
      ? {
          id: row.transferPair.stagedId,
          heading: row.transferPair.heading,
          account: row.transferPair.accountLabel,
          date: row.transferPair.dateYmd,
          outflow: row.transferPair.outflow,
        }
      : null,
  };
}

export function serializeRevision(row: RevisionRow) {
  return {
    id: row.id,
    heading: row.heading,
    bank: row.institutionName,
    approvedAmountCents: row.approvedAmountCents,
    bankAmountCents: row.bankAmountCents,
    date: row.bankDateYmd,
  };
}

/** Each linked bank, and the one thing it needs from the user on the website, if anything. */
export async function listBanksForApi(db: Pick<PrismaClient, "plaidItem">, userId: string) {
  const items = await db.plaidItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
      consentExpiresAt: true,
      pendingExpirationAt: true,
      pendingDisconnectAt: true,
      pendingDisconnectReason: true,
      newAccountsAvailableAt: true,
    },
  });
  return items.map((item) => {
    const attention = describePlaidItemAttention(item);
    return {
      id: item.id,
      name: item.institutionName ?? "Your bank",
      lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
      attention: attention ? { kind: attention.kind, message: attention.message, actionLabel: attention.actionLabel } : null,
    };
  });
}

export async function reviewQueueForApi(db: PrismaClient, userId: string) {
  const [queue, banks] = await Promise.all([loadReviewQueue(db, userId, API_QUEUE_LIMIT), listBanksForApi(db, userId)]);
  return {
    total: queue.total,
    rows: queue.rows.map(serializeReviewRow),
    revisions: queue.revisions.map(serializeRevision),
    categories: queue.categories,
    banks,
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

const id = (what: string) => z.string(`${what} is required.`).min(1, `${what} is required.`);

const decisionSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({ decision: z.literal("ignore") }),
    z.object({ decision: z.literal("link"), transactionId: id("'transactionId'") }),
    z.object({
      decision: z.literal("add"),
      /** Book it as something other than the sync guessed: the website's "transfer" box. */
      countAs: z.enum(["expense", "income", "transfer"], "'countAs' must be expense, income or transfer.").optional(),
      categoryId: id("'categoryId'").optional(),
    }),
  ],
  "'decision' must be add, link or ignore.",
);

const COUNT_AS = { expense: TransactionType.EXPENSE, income: TransactionType.INCOME, transfer: TransactionType.TRANSFER };

/** The body of `POST /api/v1/review-queue/:id`. */
export function parseDecisionBody(body: unknown): Parsed<StagedDecision> {
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Invalid decision.") };
  const value = parsed.data;
  if (value.decision !== "add") return { ok: true, value };
  return {
    ok: true,
    value: {
      decision: "add",
      countAs: value.countAs ? COUNT_AS[value.countAs] : null,
      categoryId: value.categoryId ?? null,
    },
  };
}

const pairSchema = z.object({ id: id("'id'"), peerId: id("'peerId'") });

/** The body of `POST /api/v1/review-queue/pair`: the two bank rows that are one transfer. */
export function parsePairBody(body: unknown): Parsed<{ id: string; peerId: string }> {
  const parsed = pairSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Invalid pair.") };
  if (parsed.data.id === parsed.data.peerId) return { ok: false, error: "Choose the two sides of the transfer." };
  return { ok: true, value: parsed.data };
}

const idList = z
  .array(id("Each id"), "'ids' must be a list of ids.")
  .min(1, "'ids' must name at least one row.")
  .max(API_BULK_MAX, `At most ${API_BULK_MAX} rows at once.`);

const bulkSchema = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("add"), ids: idList, categoryId: id("'categoryId'").optional() }),
    z.object({ action: z.literal("ignore"), ids: idList }),
    z.object({
      action: z.literal("link"),
      links: z
        .array(z.object({ id: id("Each link's 'id'"), transactionId: id("Each link's 'transactionId'") }), "'links' must be a list.")
        .min(1, "'links' must name at least one row.")
        .max(API_BULK_MAX, `At most ${API_BULK_MAX} rows at once.`),
    }),
  ],
  "'action' must be add, ignore or link.",
);

export type BulkRequest =
  | { action: "add"; ids: string[]; categoryId: string | null }
  | { action: "ignore"; ids: string[] }
  | { action: "link"; links: { stagedId: string; transactionId: string }[] };

/** The body of `POST /api/v1/review-queue/bulk`: "Add all", "Link all strong matches", or ticked rows. */
export function parseBulkBody(body: unknown): Parsed<BulkRequest> {
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Invalid request.") };
  const value = parsed.data;
  switch (value.action) {
    case "add":
      return { ok: true, value: { action: "add", ids: [...new Set(value.ids)], categoryId: value.categoryId ?? null } };
    case "ignore":
      return { ok: true, value: { action: "ignore", ids: [...new Set(value.ids)] } };
    case "link":
      return {
        ok: true,
        value: { action: "link", links: value.links.map((link) => ({ stagedId: link.id, transactionId: link.transactionId })) },
      };
  }
}

const revisionSchema = z.object({
  action: z.enum(["apply", "dismiss"], "'action' must be apply or dismiss."),
});

/** The body of `POST /api/v1/review-queue/revisions/:id`: take the bank's amount, or keep yours. */
export function parseRevisionBody(body: unknown): Parsed<"apply" | "dismiss"> {
  const parsed = revisionSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Invalid request.") };
  return { ok: true, value: parsed.data.action };
}
