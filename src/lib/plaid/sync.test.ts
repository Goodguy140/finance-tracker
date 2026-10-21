import { CategoryKind, PlaidStagedStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import { PlaidSyncBusyError, syncPlaidItem, type SyncItemRecord, type SyncStore } from "@/lib/plaid/sync";
import type { ExistingStagedRow, PagePlan } from "@/lib/plaid/sync-plan";
import type { PlaidApiTransaction, PlaidSyncPage } from "@/lib/plaid/types";

function txn(id: string, overrides: Partial<PlaidApiTransaction> = {}): PlaidApiTransaction {
  return {
    transaction_id: id,
    account_id: "plaid-acct-1",
    amount: 10,
    iso_currency_code: "CAD",
    date: "2026-09-10",
    name: "TEST",
    pending: false,
    ...overrides,
  };
}

function pageOf(added: PlaidApiTransaction[], cursor: string, hasMore: boolean): PlaidSyncPage {
  return { added, modified: [], removed: [], next_cursor: cursor, has_more: hasMore, accounts: [] };
}

function itemRecord(overrides: Partial<SyncItemRecord> = {}): SyncItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    cursor: null,
    accessToken: "access-token",
    initialSyncPending: true,
    context: {
      historyCutoff: new Date(Date.UTC(2026, 0, 1)),
      accounts: new Map([["plaid-acct-1", { rowId: "row-1", accountId: "app-1", syncEnabled: true }]]),
      categories: [],
      budgetNames: [],
      itemDefaultCategoryId: null,
      fallbackCategoryId: {
        [CategoryKind.EXPENSE]: "cat-exp",
        [CategoryKind.INCOME]: "cat-inc",
        [CategoryKind.TRANSFER]: "cat-transfer",
      },
    },
    ...overrides,
  };
}

/** Records what the walk did, so the commit boundary can be asserted directly. */
function makeStore(item: SyncItemRecord | null, existing: ExistingStagedRow[] = []) {
  const commits: Array<{ cursorBefore: string | null; plan: PagePlan; completesWalk: boolean }> = [];
  const store: SyncStore = {
    acquireLock: vi.fn(async () => item),
    releaseLock: vi.fn(async () => {}),
    loadExistingStaged: vi.fn(async () => existing),
    loadApprovedAmounts: vi.fn(async () => new Map<string, number>()),
    commitPage: vi.fn(async (committedItem, plan, { completesWalk }) => {
      commits.push({ cursorBefore: committedItem.cursor, plan, completesWalk });
    }),
    finalize: vi.fn(async () => {}),
    matchPendingRows: vi.fn(async () => 0),
    recordBalances: vi.fn(async () => {}),
  };
  return { store, commits };
}

function clientWithPages(pages: PlaidSyncPage[]): { client: PlaidClient; calls: (string | null)[] } {
  const calls: (string | null)[] = [];
  let i = 0;
  const client = {
    transactionsSync: vi.fn(async ({ cursor }: { cursor: string | null }) => {
      calls.push(cursor);
      return pages[Math.min(i++, pages.length - 1)];
    }),
  } as unknown as PlaidClient;
  return { client, calls };
}

describe("syncPlaidItem: pagination and cursor", () => {
  it("walks every page and commits each with the cursor that produced it", async () => {
    const { client, calls } = clientWithPages([
      pageOf([txn("a")], "cursor-1", true),
      pageOf([txn("b")], "cursor-2", true),
      pageOf([txn("c")], "cursor-3", false),
    ]);
    const { store, commits } = makeStore(itemRecord());

    const summary = await syncPlaidItem({ client, store }, "item-1");

    expect(summary.pages).toBe(3);
    expect(summary.staged).toBe(3);
    expect(calls).toEqual([null, "cursor-1", "cursor-2"]);
    // The cursor a page was fetched WITH is what accompanies that page's writes; the
    // cursor it produced is what the commit advances to.
    expect(commits.map((c) => c.cursorBefore)).toEqual([null, "cursor-1", "cursor-2"]);
    expect(commits.map((c) => c.plan.nextCursor)).toEqual(["cursor-1", "cursor-2", "cursor-3"]);
    // Only the last page stores its cursor: a cursor from mid-walk is never resumed from.
    expect(commits.map((c) => c.completesWalk)).toEqual([false, false, true]);
  });

  it("stops as soon as has_more is false", async () => {
    const { client } = clientWithPages([pageOf([txn("a")], "cursor-1", false)]);
    const { store } = makeStore(itemRecord());
    const summary = await syncPlaidItem({ client, store }, "item-1");
    expect(summary.pages).toBe(1);
    expect(client.transactionsSync).toHaveBeenCalledTimes(1);
  });

  it("resumes an incremental sync from the stored cursor", async () => {
    const { client, calls } = clientWithPages([pageOf([], "cursor-9", false)]);
    const { store } = makeStore(itemRecord({ cursor: "cursor-8", initialSyncPending: false }));
    await syncPlaidItem({ client, store }, "item-1");
    expect(calls).toEqual(["cursor-8"]);
  });
});

describe("syncPlaidItem: failure handling", () => {
  it("restarts the walk from the cursor it began with on a mid-pagination mutation", async () => {
    const mutation = new PlaidApiError({
      message: "mutation",
      errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
      errorType: "TRANSACTIONS_ERROR",
      requestId: null,
      httpStatus: 400,
    });
    const calls: (string | null)[] = [];
    let call = 0;
    const client = {
      transactionsSync: vi.fn(async ({ cursor }: { cursor: string | null }) => {
        calls.push(cursor);
        call += 1;
        if (call === 1) return pageOf([txn("a")], "cursor-1", true);
        if (call === 2) throw mutation;
        if (call === 3) return pageOf([txn("a")], "cursor-1b", true);
        return pageOf([txn("b")], "cursor-2", false);
      }),
    } as unknown as PlaidClient;
    const { store, commits } = makeStore(itemRecord({ cursor: "cursor-0", initialSyncPending: false }));

    const summary = await syncPlaidItem({ client, store }, "item-1");

    // Plaid's contract: after a mutation, restart from the cursor the walk BEGAN with
    // (cursor-0), not from cursor-1, a page the mutated walk produced.
    expect(calls).toEqual(["cursor-0", "cursor-1", "cursor-0", "cursor-1b"]);
    // The aborted walk never stored a cursor; the restarted one stores its final cursor.
    expect(commits.map((c) => c.completesWalk)).toEqual([false, false, true]);
    expect(commits.at(-1)?.plan.nextCursor).toBe("cursor-2");
    // Only the walk that finished is counted.
    expect(summary.pages).toBe(2);
    expect(summary.staged).toBe(2);
  });

  it("fails rather than storing a mid-walk cursor when has_more never ends", async () => {
    const { client } = clientWithPages([pageOf([], "cursor-n", true)]);
    const { store, commits } = makeStore(itemRecord());

    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toThrow(/more than 200 pages/);
    expect(commits.some((c) => c.completesWalk)).toBe(false);
    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it("gives up after repeated mutations rather than looping", async () => {
    const mutation = new PlaidApiError({
      message: "mutation",
      errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
      errorType: "TRANSACTIONS_ERROR",
      requestId: null,
      httpStatus: 400,
    });
    const client = {
      transactionsSync: vi.fn(async () => {
        throw mutation;
      }),
    } as unknown as PlaidClient;
    const { store } = makeStore(itemRecord());
    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toBe(mutation);
    expect(client.transactionsSync).toHaveBeenCalledTimes(4); // initial + 3 restarts
  });

  it("records a re-auth requirement and still releases the lock", async () => {
    const loginRequired = new PlaidApiError({
      message: "login required",
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorType: "ITEM_ERROR",
      requestId: null,
      httpStatus: 400,
    });
    const client = {
      transactionsSync: vi.fn(async () => {
        throw loginRequired;
      }),
    } as unknown as PlaidClient;
    const { store } = makeStore(itemRecord());

    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toBe(loginRequired);
    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ needsReauth: true }));
    expect(store.releaseLock).toHaveBeenCalledWith("item-1");
  });

  it("releases the lock after an ordinary failure too", async () => {
    const boom = new Error("network down");
    const client = {
      transactionsSync: vi.fn(async () => {
        throw boom;
      }),
    } as unknown as PlaidClient;
    const { store } = makeStore(itemRecord());
    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toBe(boom);
    expect(store.releaseLock).toHaveBeenCalledTimes(1);
    expect(store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network down", needsReauth: false }),
    );
  });

  it("refuses when another sync already holds the lock", async () => {
    const { client } = clientWithPages([pageOf([], "c", false)]);
    const { store } = makeStore(null);
    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toBeInstanceOf(
      PlaidSyncBusyError,
    );
    expect(client.transactionsSync).not.toHaveBeenCalled();
    // Nothing was acquired, so nothing may be released — releasing here would clear a
    // lock belonging to the sync that is actually running.
    expect(store.releaseLock).not.toHaveBeenCalled();
  });
});

describe("syncPlaidItem: finalisation", () => {
  it("records the earliest observed date only on the first full walk", async () => {
    const { client } = clientWithPages([
      pageOf([txn("a", { date: "2026-03-04" }), txn("b", { date: "2026-08-01" })], "c", false),
    ]);
    const { store } = makeStore(itemRecord({ initialSyncPending: true }));
    await syncPlaidItem({ client, store }, "item-1");
    expect(store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        completedInitialSync: true,
        earliestObserved: new Date("2026-03-04T00:00:00Z"),
      }),
    );
  });

  it("does not overwrite the earliest observed date on later syncs", async () => {
    // An incremental sync only sees recent activity; writing its minimum would make the
    // shortfall message claim the bank holds far less than it does.
    const { client } = clientWithPages([pageOf([txn("a", { date: "2026-09-10" })], "c", false)]);
    const { store } = makeStore(itemRecord({ initialSyncPending: false, cursor: "prev" }));
    await syncPlaidItem({ client, store }, "item-1");
    expect(store.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ completedInitialSync: false, earliestObserved: null }),
    );
  });

  it("matches unreviewed rows once the walk is complete, not per page", async () => {
    const { client } = clientWithPages([
      pageOf([txn("a")], "c1", true),
      pageOf([txn("b")], "c2", false),
    ]);
    const { store } = makeStore(itemRecord());
    await syncPlaidItem({ client, store }, "item-1");
    expect(store.matchPendingRows).toHaveBeenCalledTimes(1);
  });

  it("does not match when the walk failed", async () => {
    const client = {
      transactionsSync: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as unknown as PlaidClient;
    const { store } = makeStore(itemRecord());
    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toThrow();
    expect(store.matchPendingRows).not.toHaveBeenCalled();
  });
});

describe("syncPlaidItem: replay safety", () => {
  it("produces the same writes when a page is replayed", async () => {
    // What makes the commit boundary safe: re-running a page must be a no-op, which it is
    // because every staged row is keyed on (userId, plaidTransactionId).
    const page = pageOf([txn("a"), txn("b")], "cursor-1", false);
    const first = makeStore(itemRecord());
    await syncPlaidItem({ client: clientWithPages([page]).client, store: first.store }, "item-1");

    const second = makeStore(
      itemRecord(),
      first.commits[0].plan.upserts.map((u) => ({
        plaidTransactionId: u.plaidTransactionId,
        status: PlaidStagedStatus.NEEDS_REVIEW,
        resolvedTransactionId: null,
      })),
    );
    await syncPlaidItem({ client: clientWithPages([page]).client, store: second.store }, "item-1");

    expect(second.commits[0].plan.upserts.map((u) => u.plaidTransactionId)).toEqual(
      first.commits[0].plan.upserts.map((u) => u.plaidTransactionId),
    );
  });
});

describe("syncPlaidItem: bank revisions", () => {
  const committed: ExistingStagedRow = {
    plaidTransactionId: "a",
    status: PlaidStagedStatus.LINKED,
    resolvedTransactionId: "txn-a",
  };
  const modifiedPage = (amount: number): PlaidSyncPage => ({
    added: [],
    modified: [txn("a", { amount, name: "TEST RENAMED" })],
    removed: [],
    accounts: [],
    next_cursor: "cursor-1",
    has_more: false,
  });

  it("does not ask about a revision whose amount matches the log", async () => {
    const { client } = clientWithPages([modifiedPage(10)]);
    const { store, commits } = makeStore(itemRecord(), [committed]);
    vi.mocked(store.loadApprovedAmounts).mockResolvedValue(new Map([["txn-a", 1000]]));

    const summary = await syncPlaidItem({ client, store }, "item-1");

    expect(store.loadApprovedAmounts).toHaveBeenCalledWith("user-1", ["txn-a"]);
    expect(commits[0].plan.flagRevised).toEqual([]);
    expect(summary.revised).toBe(0);
  });

  it("still asks when the bank's amount differs", async () => {
    const { client } = clientWithPages([modifiedPage(12)]);
    const { store, commits } = makeStore(itemRecord(), [committed]);
    vi.mocked(store.loadApprovedAmounts).mockResolvedValue(new Map([["txn-a", 1000]]));

    const summary = await syncPlaidItem({ client, store }, "item-1");

    expect(commits[0].plan.flagRevised).toEqual([{ plaidTransactionId: "a", transactionId: "txn-a" }]);
    expect(summary.revised).toBe(1);
  });
});

describe("syncPlaidItem: balances", () => {
  const account = (account_id: string, current: number | null) => ({
    account_id,
    name: "Acct",
    type: "depository",
    balances: { current, iso_currency_code: "CAD" },
  });

  it("records the last page's balances for mapped accounts once the walk completes", async () => {
    const { client } = clientWithPages([
      { ...pageOf([txn("a")], "cursor-1", true), accounts: [account("plaid-acct-1", 10)] },
      { ...pageOf([txn("b")], "cursor-2", false), accounts: [account("plaid-acct-1", 12.34), account("unmapped", 99)] },
    ]);
    const { store } = makeStore(itemRecord());
    await syncPlaidItem({ client, store }, "item-1");
    expect(store.recordBalances).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.recordBalances).mock.calls[0][1]).toEqual([{ accountId: "app-1", balanceCents: 1234 }]);
  });

  it("records nothing when the walk fails", async () => {
    const client = {
      transactionsSync: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as PlaidClient;
    const { store } = makeStore(itemRecord());
    await expect(syncPlaidItem({ client, store }, "item-1")).rejects.toThrow("boom");
    expect(store.recordBalances).not.toHaveBeenCalled();
  });
});
