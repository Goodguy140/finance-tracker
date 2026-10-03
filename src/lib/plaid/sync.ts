import { PlaidApiError, PLAID_SYNC_PAGE_SIZE, type PlaidClient } from "@/lib/plaid/client";
import {
  keepChangedRevisions,
  markChangedTransfers,
  planPage,
  referencedPlaidTransactionIds,
  type ExistingStagedRow,
  type PagePlan,
  type SkipCounts,
  type SyncItemContext,
} from "@/lib/plaid/sync-plan";

/**
 * Walking /transactions/sync and committing what it returns.
 *
 * The correctness argument is the commit boundary: each page's rows AND the cursor that
 * page produced are written in one database transaction. A crash therefore replays exactly
 * one page, and because every staged row is keyed on (userId, plaidTransactionId) the
 * replay is a no-op. Advancing the cursor outside that transaction would lose a page on
 * any failure; advancing it before the writes would lose it on every failure.
 */

/** A sync in flight older than this is assumed dead and may be taken over. */
export const SYNC_LOCK_STALE_MS = 10 * 60_000;

/** Plaid can mutate an item mid-walk; the documented recovery is to restart it. */
const MAX_PAGINATION_RESTARTS = 3;

/** Defensive stop so a misbehaving cursor cannot loop forever. */
const MAX_PAGES = 200;

export type SyncSummary = {
  staged: number;
  superseded: number;
  removed: number;
  revised: number;
  transferred: number;
  pages: number;
  skipped: SkipCounts;
  needsReauth: boolean;
  /** Oldest date the institution returned across the whole walk. */
  earliestObserved: Date | null;
};

export type SyncItemRecord = {
  id: string;
  userId: string;
  cursor: string | null;
  accessToken: string;
  context: SyncItemContext;
  /** False once the first full walk has completed. */
  initialSyncPending: boolean;
};

/**
 * Everything `syncPlaidItem` needs from the database.
 *
 * A seam, so the walk above can be tested against an in-memory implementation — the
 * pagination, cursor and pending-transition logic is where the bugs live, and none of it
 * needs SQLite to exercise.
 */
export type SyncStore = {
  /** Returns the item with a lock held, or null when another sync already holds it. */
  acquireLock(itemId: string, staleBefore: Date, now: Date): Promise<SyncItemRecord | null>;
  releaseLock(itemId: string): Promise<void>;
  loadExistingStaged(userId: string, plaidTransactionIds: string[]): Promise<ExistingStagedRow[]>;
  /**
   * Amounts of the transactions those staged rows were committed to, as money out
   * (`outflowCents`), so they compare with a bank row whatever type the user booked it as.
   */
  loadApprovedAmounts(userId: string, transactionIds: string[]): Promise<Map<string, number>>;
  /** Applies one page's writes AND its cursor atomically. */
  commitPage(item: SyncItemRecord, plan: PagePlan): Promise<void>;
  finalize(input: {
    itemId: string;
    now: Date;
    earliestObserved: Date | null;
    completedInitialSync: boolean;
    error: string | null;
    needsReauth: boolean;
  }): Promise<void>;
  /** Scores unreviewed rows against the user's own transactions, and links the exact ones. */
  matchPendingRows(item: SyncItemRecord): Promise<number>;
};

export type SyncDeps = {
  client: PlaidClient;
  store: SyncStore;
  now?: () => Date;
};

export class PlaidSyncBusyError extends Error {
  constructor() {
    super("A sync is already running for this bank. Give it a moment and try again.");
    this.name = "PlaidSyncBusyError";
  }
}

function emptySkips(): SkipCounts {
  return { beforeCutoff: 0, unmapped: 0, zero: 0, outOfRange: 0, unusable: 0 };
}

function addSkips(into: SkipCounts, from: SkipCounts): void {
  into.beforeCutoff += from.beforeCutoff;
  into.unmapped += from.unmapped;
  into.zero += from.zero;
  into.outOfRange += from.outOfRange;
  into.unusable += from.unusable;
}

export async function syncPlaidItem(deps: SyncDeps, itemId: string): Promise<SyncSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const staleBefore = new Date(startedAt.getTime() - SYNC_LOCK_STALE_MS);

  const item = await deps.store.acquireLock(itemId, staleBefore, startedAt);
  if (!item) throw new PlaidSyncBusyError();

  const summary: SyncSummary = {
    staged: 0,
    superseded: 0,
    removed: 0,
    revised: 0,
    transferred: 0,
    pages: 0,
    skipped: emptySkips(),
    needsReauth: false,
    earliestObserved: null,
  };

  // Tracked separately from `item.cursor` so a restart resumes from the last COMMITTED
  // page rather than from wherever the failed walk had reached.
  let committedCursor = item.cursor;
  let restarts = 0;

  try {
    walk: for (;;) {
      let cursor = committedCursor;

      for (let guard = 0; guard < MAX_PAGES; guard++) {
        let page;
        try {
          page = await deps.client.transactionsSync({
            accessToken: item.accessToken,
            cursor,
            count: PLAID_SYNC_PAGE_SIZE,
          });
        } catch (err) {
          if (err instanceof PlaidApiError && err.isPaginationMutation) {
            // Plaid changed the item underneath us. Restart from the last committed
            // cursor; the unique key makes re-applying already-seen rows a no-op.
            if (restarts >= MAX_PAGINATION_RESTARTS) throw err;
            restarts += 1;
            continue walk;
          }
          throw err;
        }

        const referenced = referencedPlaidTransactionIds(page);
        const existingRows = await deps.store.loadExistingStaged(item.userId, referenced);
        const existing = new Map(existingRows.map((row) => [row.plaidTransactionId, row]));

        let plan = planPage(page, item.context, existing);

        if (plan.transfers.length > 0 || plan.flagRevised.length > 0) {
          const approved = await deps.store.loadApprovedAmounts(item.userId, [
            ...plan.transfers.map((t) => t.transactionId),
            ...plan.flagRevised.flatMap((r) => (r.transactionId ? [r.transactionId] : [])),
          ]);
          plan = keepChangedRevisions(markChangedTransfers(plan, approved), approved);
        }

        await deps.store.commitPage({ ...item, cursor }, plan);

        summary.pages += 1;
        summary.staged += plan.upserts.length;
        summary.superseded += plan.supersede.length;
        summary.removed += plan.markRemoved.length + plan.flagRemovedOnVerification.length;
        summary.revised += plan.flagRevised.length;
        summary.transferred += plan.transfers.length;
        addSkips(summary.skipped, plan.skipped);
        if (plan.earliestSeen && (!summary.earliestObserved || plan.earliestSeen < summary.earliestObserved)) {
          summary.earliestObserved = plan.earliestSeen;
        }

        committedCursor = plan.nextCursor;
        cursor = plan.nextCursor;
        if (!page.has_more) break walk;
      }
      // Ran past MAX_PAGES without has_more going false.
      break walk;
    }

    await deps.store.finalize({
      itemId: item.id,
      now: now(),
      // Only meaningful for the first full walk; later syncs see only new activity and
      // would otherwise overwrite the real figure with a recent date.
      earliestObserved: item.initialSyncPending ? summary.earliestObserved : null,
      completedInitialSync: item.initialSyncPending,
      error: null,
      needsReauth: false,
    });

    await deps.store.matchPendingRows(item);
    return summary;
  } catch (err) {
    const needsReauth = err instanceof PlaidApiError && err.needsReauth;
    summary.needsReauth = needsReauth;
    await deps.store.finalize({
      itemId: item.id,
      now: now(),
      earliestObserved: null,
      completedInitialSync: false,
      error: err instanceof Error ? err.message : String(err),
      needsReauth,
    });
    throw err;
  } finally {
    // Always released: a lock left behind by a crashed sync would block the item until
    // the stale threshold, and one left by a *handled* failure would be a plain bug.
    await deps.store.releaseLock(item.id);
  }
}
