import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidClient } from "@/lib/plaid/client";

/**
 * The billing rules for starting and ending a bank connection, against the fake Plaid and a
 * real SQLite database built from the migrations. Every refusal here has a cost at Plaid if
 * it gets this wrong, so each test also checks what happened on Plaid's side.
 */

const dir = mkdtempSync(join(tmpdir(), "plaid-connections-"));
const url = `file:${join(dir, "connections.db")}`;
let db: PrismaClient;
let connections: typeof import("@/lib/plaid/connections");
let fake: typeof import("@/lib/plaid/fake-client");

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  // Everything that reaches the app's shared Prisma client is imported after this line.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  connections = await import("@/lib/plaid/connections");
  fake = await import("@/lib/plaid/fake-client");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function newUser() {
  seq += 1;
  return db.user.create({
    data: { email: `c${seq}@example.test`, displayName: "Test", countryCode: "CA", timezone: "America/Toronto" },
  });
}

/** The fake client with `removeItem` watched, so a test can see what was revoked at Plaid. */
function watchedClient(): PlaidClient & { removeItem: ReturnType<typeof vi.fn> } {
  const client = fake.createFakePlaidClient();
  return { ...client, removeItem: vi.fn(client.removeItem) };
}

function publicToken() {
  seq += 1;
  return `${fake.FAKE_PUBLIC_TOKEN_PREFIX}conn-${seq}`;
}

let client: ReturnType<typeof watchedClient>;
beforeEach(() => {
  client = watchedClient();
});

describe("linkBank", () => {
  it("stores the connection and its accounts, with the history window fixed at link time", async () => {
    const user = await newUser();
    const now = new Date("2026-10-03T12:00:00Z");
    const outcome = await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90, now });

    expect(outcome).toMatchObject({ kind: "linked", mode: "create", institutionName: fake.FAKE_INSTITUTION_NAME, accountCount: 3 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id }, include: { plaidAccounts: true } });
    expect(item.requestedDays).toBe(90);
    expect(item.historyCutoff.getTime()).toBeLessThan(now.getTime());
    expect(item.plaidAccounts.map((a) => a.plaidAccountId).sort()).toEqual(fake.FAKE_ACCOUNTS.map((a) => a.account_id).sort());
    expect(client.removeItem).not.toHaveBeenCalled();
  });

  it("refuses a second connection to the same bank and removes the new Item at Plaid", async () => {
    const user = await newUser();
    await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });

    const second = await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });

    expect(second).toEqual({ kind: "refused", reason: "same-institution", institutionName: fake.FAKE_INSTITUTION_NAME });
    // The refused Item is billable from the moment it was exchanged; it must not survive.
    expect(client.removeItem).toHaveBeenCalledTimes(1);
    expect(await db.plaidItem.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuses an Item another user here already holds, and removes it at Plaid", async () => {
    const owner = await newUser();
    await connections.linkBank({ prisma: db, client }, { user: owner, publicToken: publicToken(), days: 90 });
    const held = await db.plaidItem.findFirstOrThrow({ where: { userId: owner.id } });
    const accessToken = `access-sandbox-${held.itemId}`;
    // Plaid handing back an item_id this deployment already stores.
    const replaying = { ...client, exchangePublicToken: async () => ({ access_token: accessToken, item_id: held.itemId }) };

    const other = await newUser();
    const outcome = await connections.linkBank({ prisma: db, client: replaying }, { user: other, publicToken: "x", days: 90 });

    expect(outcome).toEqual({ kind: "refused", reason: "linked-elsewhere" });
    expect(client.removeItem).toHaveBeenCalledWith(accessToken);
    expect(await db.plaidItem.count({ where: { userId: other.id } })).toBe(0);
  });

  it("treats an Item the same user already holds as a re-authentication that clears its prompts", async () => {
    const user = await newUser();
    await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 30 });
    const held = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
    await db.plaidItem.update({
      where: { id: held.id },
      data: { status: "LOGIN_REQUIRED", pendingExpirationAt: new Date(), consecutiveSyncFailures: 3, cursor: "kept" },
    });
    const replaying = {
      ...client,
      exchangePublicToken: async () => ({ access_token: `access-sandbox-${held.itemId}`, item_id: held.itemId }),
    };

    const outcome = await connections.linkBank({ prisma: db, client: replaying }, { user, publicToken: "x", days: 730 });

    expect(outcome).toMatchObject({ kind: "linked", mode: "reauth", plaidItemId: held.id });
    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: held.id } });
    expect(after).toMatchObject({ status: "ACTIVE", pendingExpirationAt: null, consecutiveSyncFailures: 0 });
    // The history window and cursor are the user's original choice and progress.
    expect(after).toMatchObject({ requestedDays: 30, cursor: "kept", historyCutoff: held.historyCutoff });
    expect(client.removeItem).not.toHaveBeenCalled();
  });
});

describe("completeUpdate", () => {
  it("picks up accounts the user just shared and clears the new-accounts prompt", async () => {
    const user = await newUser();
    await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
    await db.plaidItem.update({ where: { id: item.id }, data: { newAccountsAvailableAt: new Date() } });
    const { openAccessToken } = await import("@/lib/plaid/service");
    // What opening account-selection update mode does at Plaid.
    await client.createLinkToken({
      clientUserId: user.id,
      clientName: "Test",
      countryCodes: ["CA"],
      accessToken: openAccessToken(item),
      accountSelection: true,
    });

    const result = await connections.completeUpdate({ prisma: db, client }, item, "accounts");

    expect(result).toEqual({ accountCount: 4, newAccounts: 1 });
    const after = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.newAccountsAvailableAt).toBeNull();
  });
});

describe("endConnection", () => {
  it("removes the Item at Plaid and then deletes what was synced under it", async () => {
    const user = await newUser();
    await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });

    await connections.endConnection({ prisma: db, client }, item);

    expect(client.removeItem).toHaveBeenCalledTimes(1);
    expect(await db.plaidItem.count({ where: { id: item.id } })).toBe(0);
    expect(await db.plaidAccount.count({ where: { plaidItemId: item.id } })).toBe(0);
  });

  it("deletes nothing when Plaid refuses to remove the Item", async () => {
    const user = await newUser();
    await connections.linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
    const refusing = {
      ...client,
      removeItem: async () => {
        throw new Error("Plaid is unavailable");
      },
    };

    await expect(connections.endConnection({ prisma: db, client: refusing }, item)).rejects.toBeInstanceOf(
      connections.ConnectionStillLiveError,
    );
    expect(await db.plaidItem.count({ where: { id: item.id } })).toBe(1);
    expect(await db.plaidAccount.count({ where: { plaidItemId: item.id } })).toBe(3);
  });
});
