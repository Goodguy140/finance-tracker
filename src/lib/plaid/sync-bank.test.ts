import { CategoryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import {
  syncBank,
  type SyncBankDeps,
} from "@/lib/plaid/sync-bank";
import type { SyncItemRecord, SyncStore } from "@/lib/plaid/sync";

const NOW = new Date("2026-10-01T12:00:00Z");
const HOUR_MS = 60 * 60_000;

type BackoffRow = { id: string; consecutiveSyncFailures: number; nextSyncAttemptAt: Date | null };

/** Just enough of `prisma.plaidItem` for the backoff writes, held in memory. */
function fakePrisma(row: BackoffRow | null) {
  const plaidItem = {
    findUnique: vi.fn(async () => (row ? { ...row, webhookUrl: null, accessTokenEnc: "x" } : null)),
    update: vi.fn(async ({ data }: { data: Partial<BackoffRow> }) => {
      Object.assign(row!, data);
      return row;
    }),
    updateMany: vi.fn(async ({ data }: { data: Partial<BackoffRow> }) => {
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  };
  return { plaidItem } as unknown as SyncBankDeps["prisma"];
}

function record(): SyncItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    cursor: "cursor-0",
    accessToken: "access-token",
    initialSyncPending: false,
    context: {
      historyCutoff: new Date(Date.UTC(2026, 0, 1)),
      accounts: new Map(),
      categories: [],
      budgetNames: [],
      itemDefaultCategoryId: null,
      fallbackCategoryId: { [CategoryKind.EXPENSE]: "cat-exp", [CategoryKind.INCOME]: "cat-inc" },
    },
  };
}

function store(locked = false): SyncStore {
  return {
    acquireLock: vi.fn(async () => (locked ? null : record())),
    releaseLock: vi.fn(async () => {}),
    loadExistingStaged: vi.fn(async () => []),
    loadApprovedAmounts: vi.fn(async () => new Map<string, number>()),
    commitPage: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
    matchPendingRows: vi.fn(async () => 0),
  };
}

function client(result: "ok" | Error): PlaidClient {
  return {
    transactionsSync: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return { added: [], modified: [], removed: [], next_cursor: "cursor-1", has_more: false };
    }),
    updateItemWebhook: vi.fn(async () => {}),
  } as unknown as PlaidClient;
}

const loginRequired = () =>
  new PlaidApiError({
    message: "login required",
    errorCode: "ITEM_LOGIN_REQUIRED",
    errorType: "ITEM_ERROR",
    requestId: null,
    httpStatus: 400,
  });

describe("syncBank", () => {
  it("clears an earlier backoff when the sync succeeds", async () => {
    const row = { id: "item-1", consecutiveSyncFailures: 3, nextSyncAttemptAt: new Date(NOW.getTime() + 4 * HOUR_MS) };
    const outcome = await syncBank({ client: client("ok"), store: store(), prisma: fakePrisma(row) }, "item-1", NOW);

    expect(outcome.kind).toBe("synced");
    expect(row.consecutiveSyncFailures).toBe(0);
    expect(row.nextSyncAttemptAt).toBeNull();
  });

  it("backs a failing bank off, further on each failure in a row", async () => {
    const row: BackoffRow = { id: "item-1", consecutiveSyncFailures: 0, nextSyncAttemptAt: null };
    const deps = { client: client(new Error("network down")), store: store(), prisma: fakePrisma(row) };

    const first = await syncBank(deps, "item-1", NOW);
    expect(first).toMatchObject({ kind: "failed", error: expect.objectContaining({ message: "network down" }) });
    expect(row.consecutiveSyncFailures).toBe(1);
    expect(row.nextSyncAttemptAt).toEqual(new Date(NOW.getTime() + HOUR_MS));

    await syncBank(deps, "item-1", NOW);
    expect(row.consecutiveSyncFailures).toBe(2);
    expect(row.nextSyncAttemptAt).toEqual(new Date(NOW.getTime() + 2 * HOUR_MS));
  });

  it("does not back off a bank that needs the user to sign in again", async () => {
    const row: BackoffRow = { id: "item-1", consecutiveSyncFailures: 0, nextSyncAttemptAt: null };
    const outcome = await syncBank(
      { client: client(loginRequired()), store: store(), prisma: fakePrisma(row) },
      "item-1",
      NOW,
    );
    expect(outcome.kind).toBe("needs-reauth");
    expect(row.consecutiveSyncFailures).toBe(0);
    expect(row.nextSyncAttemptAt).toBeNull();
  });

  it("does not count a busy bank as a failure", async () => {
    const row: BackoffRow = { id: "item-1", consecutiveSyncFailures: 2, nextSyncAttemptAt: null };
    const outcome = await syncBank({ client: client("ok"), store: store(true), prisma: fakePrisma(row) }, "item-1", NOW);
    expect(outcome.kind).toBe("busy");
    expect(row.consecutiveSyncFailures).toBe(2);
  });

  it("does not resurrect a bank unlinked while it was syncing", async () => {
    const prisma = fakePrisma(null);
    const outcome = await syncBank({ client: client(new Error("gone")), store: store(), prisma }, "item-1", NOW);
    expect(outcome.kind).toBe("failed");
    expect(prisma.plaidItem.update).not.toHaveBeenCalled();
  });
});
