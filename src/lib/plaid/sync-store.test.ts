import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Against a real SQLite database built from the migrations: the lock is a conditional update
 * on a column, and what matters is whether that column is left set.
 */

const dir = mkdtempSync(join(tmpdir(), "plaid-sync-store-"));
const url = `file:${join(dir, "sync-store.db")}`;
let db: PrismaClient;
let createSyncStore: typeof import("@/lib/plaid/sync-store").createSyncStore;
let PlaidCredentialUnreadableError: typeof import("@/lib/plaid/service").PlaidCredentialUnreadableError;

beforeAll(async () => {
  copyMigratedDatabase(url);
  // The store uses the app's shared client, which reads DATABASE_URL when it is first loaded,
  // so nothing that imports it may be loaded before this line: every app import is dynamic.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ createSyncStore } = await import("@/lib/plaid/sync-store"));
  ({ PlaidCredentialUnreadableError } = await import("@/lib/plaid/service"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("createSyncStore().acquireLock", () => {
  it("gives the lock back when the stored credential cannot be read", async () => {
    const user = await db.user.create({ data: { email: "lock@example.test", displayName: "Test" } });
    const item = await db.plaidItem.create({
      data: {
        userId: user.id,
        itemId: "item-unreadable",
        // Not ciphertext this server can open: what a rotated encryption key looks like.
        accessTokenEnc: "not-a-sealed-token",
        requestedDays: 90,
        historyCutoff: new Date("2026-06-01T00:00:00Z"),
      },
    });
    const now = new Date();
    const store = createSyncStore();

    await expect(store.acquireLock(item.id, new Date(now.getTime() - 60_000), now)).rejects.toBeInstanceOf(
      PlaidCredentialUnreadableError,
    );

    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.syncingSince).toBeNull();
  });
});

describe("createSyncStore().finalize", () => {
  async function itemWithStatus(itemId: string, status: "LOGIN_REQUIRED" | "REMOVED") {
    const user = await db.user.create({ data: { email: `${itemId}@example.test`, displayName: "Test" } });
    return db.plaidItem.create({
      data: {
        userId: user.id,
        itemId,
        accessTokenEnc: "unused",
        requestedDays: 90,
        historyCutoff: new Date("2026-06-01T00:00:00Z"),
        status,
        errorCode: "ITEM_LOGIN_REQUIRED",
        errorMessage: "Sign in again",
        // Raised separately by Plaid; a sync does not answer it.
        pendingExpirationAt: new Date("2026-10-01T00:00:00Z"),
      },
    });
  }

  const outcome = (itemId: string, error: string | null) => ({
    itemId,
    now: new Date(),
    earliestObserved: null,
    completedInitialSync: false,
    error,
    needsReauth: error !== null,
  });

  it("clears needs-sign-in once a sync gets through", async () => {
    const item = await itemWithStatus("item-signed-in", "LOGIN_REQUIRED");

    await createSyncStore().finalize(outcome(item.id, null));

    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after).toMatchObject({ status: "ACTIVE", errorCode: null, errorMessage: null });
    expect(after.pendingExpirationAt).not.toBeNull();
  });

  it("leaves needs-sign-in in place when the sync failed", async () => {
    const item = await itemWithStatus("item-still-locked", "LOGIN_REQUIRED");

    await createSyncStore().finalize(outcome(item.id, "Sign in again"));

    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe("LOGIN_REQUIRED");
  });

  it("does not bring a removed connection back", async () => {
    const item = await itemWithStatus("item-removed", "REMOVED");

    await createSyncStore().finalize(outcome(item.id, null));

    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe("REMOVED");
  });
});

describe("createSyncStore().commitPage", () => {
  const emptyPlan = (nextCursor: string) => ({
    upserts: [],
    supersede: [],
    transfers: [],
    markRemoved: [],
    flagRemovedOnVerification: [],
    flagRevised: [],
    nextCursor,
    skipped: { beforeCutoff: 0, unmapped: 0, zero: 0, outOfRange: 0, unusable: 0 },
    earliestSeen: null,
  });

  async function itemWithAccount(itemId: string) {
    const user = await db.user.create({ data: { email: `${itemId}@example.test`, displayName: "Test" } });
    const item = await db.plaidItem.create({
      data: {
        userId: user.id,
        itemId,
        accessTokenEnc: "unused",
        requestedDays: 90,
        historyCutoff: new Date("2026-06-01T00:00:00Z"),
        cursor: "cursor-0",
      },
    });
    const plaidAccount = await db.plaidAccount.create({
      data: { userId: user.id, plaidItemId: item.id, plaidAccountId: "acct-1", name: "Card", plaidType: "credit" },
    });
    // What the sync read when it took the lock: the account not yet mapped.
    const record = {
      id: item.id,
      userId: user.id,
      cursor: "cursor-0",
      accessToken: "unused",
      initialSyncPending: false,
      context: {
        historyCutoff: item.historyCutoff,
        accounts: new Map([["acct-1", { rowId: plaidAccount.id, accountId: null, syncEnabled: true }]]),
        categories: [],
        budgetNames: [],
        plaidMappings: [],
        itemDefaultCategoryId: null,
        fallbackCategoryId: { EXPENSE: "x", INCOME: "x", TRANSFER: "x" },
      },
    } as unknown as import("@/lib/plaid/sync").SyncItemRecord;
    return { user, item, plaidAccount, record };
  }

  const cursorOf = async (id: string) => (await db.plaidItem.findUniqueOrThrow({ where: { id } })).cursor;

  it("stores the cursor only with the page that completes the walk", async () => {
    const { item, record } = await itemWithAccount("item-commit-cursor");
    const store = createSyncStore();

    await store.commitPage(record, emptyPlan("cursor-1"), { completesWalk: false });
    expect(await cursorOf(item.id)).toBe("cursor-0");

    await store.commitPage(record, emptyPlan("cursor-2"), { completesWalk: true });
    expect(await cursorOf(item.id)).toBe("cursor-2");
  });

  it("clears the cursor when an account was mapped while the walk ran", async () => {
    const { user, item, plaidAccount, record } = await itemWithAccount("item-commit-mapped");
    const account = await db.account.create({ data: { userId: user.id, name: "Card", type: "CREDIT_CARD" } });
    await db.plaidAccount.update({ where: { id: plaidAccount.id }, data: { accountId: account.id } });

    await createSyncStore().commitPage(record, emptyPlan("cursor-1"), { completesWalk: true });

    // The walk skipped this account's rows as unmapped; the next sync must fetch them.
    expect(await cursorOf(item.id)).toBeNull();
  });
});
