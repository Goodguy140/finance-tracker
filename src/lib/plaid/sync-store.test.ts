import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  // The store uses the app's shared client, which reads DATABASE_URL when it is first loaded,
  // so nothing that imports it may be loaded before this line: every app import is dynamic.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ createSyncStore } = await import("@/lib/plaid/sync-store"));
  ({ PlaidCredentialUnreadableError } = await import("@/lib/plaid/service"));
}, 120_000);

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
