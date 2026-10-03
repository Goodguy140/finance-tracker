import { CategoryKind, PlaidStagedStatus, TransactionType } from "@prisma/client";
import {
  resolveSuggestedCategoryId,
  type UserBudgetName,
  type UserCategory,
} from "@/lib/plaid/category-map";
import { normalizePlaidTransaction } from "@/lib/plaid/ingest";
import { outflowCents } from "@/lib/transfer-type";
import type { PlaidApiTransaction, PlaidSyncPage } from "@/lib/plaid/types";

/**
 * Turning one page of /transactions/sync into a set of writes — as a pure function, so the
 * awkward parts can be tested without a database.
 *
 * The awkward parts are almost entirely about *pending* transactions. Plaid issues a new
 * transaction_id when a pending charge posts and points `pending_transaction_id` at the
 * old one, so a naive importer duplicates every pending charge a day later. Worse, if the
 * user already made a decision about the pending row, that decision has to carry over —
 * including a decision to ignore it, or the row they dismissed comes straight back.
 */

export type SyncAccountState = {
  rowId: string;
  /** The app Account this feeds. Null when unmapped — such rows are not staged at all. */
  accountId: string | null;
  syncEnabled: boolean;
};

export type SyncItemContext = {
  /** Oldest date to accept. /transactions/sync cannot be asked for a range. */
  historyCutoff: Date;
  /** Keyed by Plaid's account_id. */
  accounts: Map<string, SyncAccountState>;
  categories: UserCategory[];
  /** Custom labels on the budgets active this period, matched as category aliases. */
  budgetNames: UserBudgetName[];
  itemDefaultCategoryId: string | null;
  fallbackCategoryId: Record<CategoryKind, string>;
};

/** What we already hold for a Plaid transaction id, when deciding what a page means. */
export type ExistingStagedRow = {
  plaidTransactionId: string;
  status: PlaidStagedStatus;
  resolvedTransactionId: string | null;
};

export type StagedUpsert = {
  plaidTransactionId: string;
  plaidAccountRowId: string;
  pendingPlaidTransactionId: string | null;
  isPending: boolean;
  name: string;
  merchantName: string | null;
  amountCents: number;
  type: TransactionType;
  currency: string | null;
  date: Date;
  postedDate: Date | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  suggestedCategoryId: string;
  suggestedAccountId: string | null;
  /** Forced status, used when a decision is inherited from a superseded pending row. */
  status?: PlaidStagedStatus;
  /**
   * Carried over with an inherited decision. Without it the posted row is LINKED or ADDED
   * but points at nothing, so a later revision to it cannot be shown or applied — which is
   * precisely the tip-posting case the transfer machinery exists for.
   */
  resolvedTransactionId?: string | null;
};

/** A committed row whose bank record was replaced by its posted successor. */
export type VerificationTransfer = {
  fromPlaidTransactionId: string;
  toPlaidTransactionId: string;
  transactionId: string;
  postedDate: Date | null;
  /** True when the posted amount differs — routed through the "bank revised this" UI. */
  amountChanged: boolean;
};

/** A committed row the bank sent a modification for. */
export type RevisedRow = {
  plaidTransactionId: string;
  /** The user's transaction it was committed as; null when it points at nothing. */
  transactionId: string | null;
};

export type SkipCounts = {
  beforeCutoff: number;
  unmapped: number;
  zero: number;
  outOfRange: number;
  unusable: number;
};

export type PagePlan = {
  upserts: StagedUpsert[];
  /** Staged rows superseded by a posted successor. */
  supersede: string[];
  /** Committed rows whose verification moves to the posted transaction id. */
  transfers: VerificationTransfer[];
  /** Still-unreviewed rows Plaid withdrew. */
  markRemoved: string[];
  /** Committed rows Plaid withdrew — the transaction is never deleted. */
  flagRemovedOnVerification: string[];
  /** Committed rows the bank revised; values update, the transaction does not. */
  flagRevised: RevisedRow[];
  nextCursor: string;
  skipped: SkipCounts;
  /** Oldest date seen in this page, including rows dropped for other reasons. */
  earliestSeen: Date | null;
};

const emptySkips = (): SkipCounts => ({
  beforeCutoff: 0,
  unmapped: 0,
  zero: 0,
  outOfRange: 0,
  unusable: 0,
});

/** The two enums share their values: each type has categories of its own kind. */
function kindFor(type: TransactionType): CategoryKind {
  return type;
}

/** A staged row's amount as money out, the form `loadApprovedAmounts` reports in. */
const stagedOutflow = (upsert: StagedUpsert | undefined) =>
  upsert === undefined ? undefined : outflowCents(upsert.type, upsert.amountCents);

/** Every Plaid transaction id a page refers to, so the caller can load them in one query. */
export function referencedPlaidTransactionIds(page: PlaidSyncPage): string[] {
  const ids = new Set<string>();
  for (const row of [...page.added, ...page.modified]) {
    if (row?.transaction_id) ids.add(row.transaction_id);
    if (row?.pending_transaction_id) ids.add(row.pending_transaction_id);
  }
  for (const row of page.removed) {
    if (row?.transaction_id) ids.add(row.transaction_id);
  }
  return [...ids];
}

/** Ingest reasons are snake_case; the counters the UI reads are not. */
const SKIP_KEY: Record<"zero" | "out_of_range" | "before_cutoff" | "unusable", keyof SkipCounts> = {
  zero: "zero",
  out_of_range: "outOfRange",
  before_cutoff: "beforeCutoff",
  unusable: "unusable",
};

type BuildResult = { ok: true; upsert: StagedUpsert } | { ok: false; reason: keyof SkipCounts };

function buildUpsert(
  row: PlaidApiTransaction,
  context: SyncItemContext,
  account: SyncAccountState,
): BuildResult {
  const normalized = normalizePlaidTransaction(row, { cutoff: context.historyCutoff });
  if (!normalized.ok) return { ok: false, reason: SKIP_KEY[normalized.reason] };
  const value = normalized.value;
  const kind = kindFor(value.type);
  return {
    ok: true,
    upsert: {
      plaidTransactionId: value.plaidTransactionId,
      plaidAccountRowId: account.rowId,
      pendingPlaidTransactionId: value.pendingPlaidTransactionId,
      isPending: value.isPending,
      name: value.name,
      merchantName: value.merchantName,
      amountCents: value.amountCents,
      type: value.type,
      currency: value.currency,
      date: value.date,
      postedDate: value.postedDate,
      pfcPrimary: value.pfcPrimary,
      pfcDetailed: value.pfcDetailed,
      suggestedCategoryId: resolveSuggestedCategoryId({
        pfcPrimary: value.pfcPrimary,
        kind,
        userCategories: context.categories,
        userBudgetNames: context.budgetNames,
        itemDefaultCategoryId: context.itemDefaultCategoryId,
        fallbackCategoryId: context.fallbackCategoryId[kind],
      }),
      suggestedAccountId: account.accountId,
    },
  };
}

export function planPage(
  page: PlaidSyncPage,
  context: SyncItemContext,
  existing: Map<string, ExistingStagedRow>,
): PagePlan {
  const plan: PagePlan = {
    upserts: [],
    supersede: [],
    transfers: [],
    markRemoved: [],
    flagRemovedOnVerification: [],
    flagRevised: [],
    nextCursor: page.next_cursor,
    skipped: emptySkips(),
    earliestSeen: null,
  };

  const noteDate = (raw: string | undefined) => {
    if (!raw) return;
    const seen = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(seen.getTime())) return;
    if (!plan.earliestSeen || seen < plan.earliestSeen) plan.earliestSeen = seen;
  };

  const ingest = (row: PlaidApiTransaction, isModification: boolean) => {
    // Recorded before any filtering: "the oldest thing the bank returned" must reflect
    // what the institution actually holds, not what survived our own window.
    noteDate(row?.date);

    const account = row?.account_id ? context.accounts.get(row.account_id) : undefined;
    if (!account || !account.accountId || !account.syncEnabled) {
      // Unmapped or switched off. Not an error — the user simply has not said where this
      // account's transactions should go, so there is nowhere to stage them.
      plan.skipped.unmapped += 1;
      return;
    }

    const built = buildUpsert(row, context, account);
    if (!built.ok) {
      plan.skipped[built.reason] += 1;
      return;
    }
    const upsert = built.upsert;

    const prior = existing.get(upsert.plaidTransactionId);

    if (isModification && prior) {
      const committed =
        prior.status === PlaidStagedStatus.LINKED ||
        prior.status === PlaidStagedStatus.ADDED;
      if (committed) {
        // The bank revised a row the user already committed. Update the staged values so
        // the queue can show before/after, but never rewrite the transaction itself —
        // silently editing a committed financial record is exactly what the per-row
        // review model exists to prevent.
        plan.flagRevised.push({
          plaidTransactionId: upsert.plaidTransactionId,
          transactionId: prior.resolvedTransactionId,
        });
        plan.upserts.push(upsert);
        return;
      }
      if (prior.status === PlaidStagedStatus.IGNORED) {
        // Keep it ignored; a revision is not a reason to re-ask.
        plan.upserts.push({ ...upsert, status: PlaidStagedStatus.IGNORED });
        return;
      }
      plan.upserts.push(upsert);
      return;
    }

    // --- pending → posted ---
    const pendingId = upsert.pendingPlaidTransactionId;
    const pendingRow = pendingId ? existing.get(pendingId) : undefined;
    if (pendingId && pendingRow) {
      switch (pendingRow.status) {
        case PlaidStagedStatus.IGNORED:
          // Sticky. Without this, every ignored pending charge returns a day later as a
          // brand-new suggestion — the single most irritating way to get this wrong.
          plan.upserts.push({ ...upsert, status: PlaidStagedStatus.IGNORED });
          plan.supersede.push(pendingId);
          return;
        case PlaidStagedStatus.LINKED:
        case PlaidStagedStatus.ADDED:
          plan.upserts.push({
            ...upsert,
            status: pendingRow.status,
            resolvedTransactionId: pendingRow.resolvedTransactionId,
          });
          plan.supersede.push(pendingId);
          if (pendingRow.resolvedTransactionId) {
            plan.transfers.push({
              fromPlaidTransactionId: pendingId,
              toPlaidTransactionId: upsert.plaidTransactionId,
              transactionId: pendingRow.resolvedTransactionId,
              postedDate: upsert.postedDate ?? upsert.date,
              // A tip posting changes the amount. Route it through the revision UI
              // rather than rewriting what the user already approved.
              amountChanged: false,
            });
          }
          return;
        default:
          // Still unreviewed: replace it outright.
          plan.upserts.push(upsert);
          plan.supersede.push(pendingId);
          return;
      }
    }

    if (prior?.status === PlaidStagedStatus.IGNORED) {
      plan.upserts.push({ ...upsert, status: PlaidStagedStatus.IGNORED });
      return;
    }

    plan.upserts.push(upsert);
  };

  for (const row of page.added) ingest(row, false);
  for (const row of page.modified) ingest(row, true);

  for (const row of page.removed) {
    const id = row?.transaction_id;
    if (!id) continue;
    const prior = existing.get(id);
    if (!prior) continue;
    if (
      prior.status === PlaidStagedStatus.LINKED ||
      prior.status === PlaidStagedStatus.ADDED
    ) {
      // The user's transaction stays. Only the badge changes, to say the bank later
      // withdrew the record it was confirmed against.
      plan.flagRemovedOnVerification.push(id);
      continue;
    }
    if (prior.status === PlaidStagedStatus.SUPERSEDED) {
      // Banks routinely emit `removed` for a pending row right after its posted
      // successor arrives. Already handled.
      continue;
    }
    plan.markRemoved.push(id);
  }

  return plan;
}

/** Marks transfers whose posted amount differs from what was approved. */
export function markChangedTransfers(
  plan: PagePlan,
  approvedAmountByTransactionId: Map<string, number>,
): PagePlan {
  const byNewId = new Map(plan.upserts.map((u) => [u.plaidTransactionId, u]));
  return {
    ...plan,
    transfers: plan.transfers.map((transfer) => {
      const approved = approvedAmountByTransactionId.get(
        transfer.transactionId,
      );
      const posted = stagedOutflow(byNewId.get(transfer.toPlaidTransactionId));
      const amountChanged =
        approved !== undefined && posted !== undefined && approved !== posted;
      return { ...transfer, amountChanged };
    }),
  };
}

/**
 * Drops revisions whose amount still equals the user's transaction.
 *
 * Plaid sends `modified` for far more than the amount — a cleaned-up name, a category, a
 * date shift — and asking "use the bank's value or keep mine?" when both are the same
 * number is a question with nothing to decide. The staged copy still takes the new values.
 */
export function keepChangedRevisions(
  plan: PagePlan,
  approvedAmountByTransactionId: Map<string, number>,
): PagePlan {
  const byId = new Map(plan.upserts.map((u) => [u.plaidTransactionId, u]));
  return {
    ...plan,
    flagRevised: plan.flagRevised.filter((revised) => {
      const approved = revised.transactionId
        ? approvedAmountByTransactionId.get(revised.transactionId)
        : undefined;
      const reported = stagedOutflow(byId.get(revised.plaidTransactionId));
      return approved === undefined || reported === undefined || approved !== reported;
    }),
  };
}
