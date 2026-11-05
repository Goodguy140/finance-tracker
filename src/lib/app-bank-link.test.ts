import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient, User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidClient } from "@/lib/plaid/client";
import { registerIosPasskey } from "@/test-support/ios-passkey";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Connecting and fixing banks from the phone app, against a real database, the fake Plaid and the
 * real passkey check: Face ID (a passkey assertion) before Link opens, one finish per start from
 * the same phone, and the website's billing rules on what Link hands back.
 */

const RP_ID = "money.example.com";
process.env.NEXTAUTH_URL = `https://${RP_ID}`;
process.env.APPLE_APP_ID = "ABCDE12345.com.example.finances";

const dir = mkdtempSync(join(tmpdir(), "app-bank-link-"));
const url = `file:${join(dir, "app-bank-link.db")}`;
let db: PrismaClient;
let lib: typeof import("./app-bank-link");
let banks: typeof import("./api-v1/banks");
let fake: typeof import("@/lib/plaid/fake-client");
let createAuthenticationOptions: typeof import("./webauthn").createAuthenticationOptions;
let issueAppDeviceToken: typeof import("./app-devices").issueAppDeviceToken;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  lib = await import("./app-bank-link");
  banks = await import("./api-v1/banks");
  fake = await import("@/lib/plaid/fake-client");
  ({ createAuthenticationOptions } = await import("./webauthn"));
  ({ issueAppDeviceToken } = await import("./app-devices"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

type WatchedClient = PlaidClient & {
  createLinkToken: ReturnType<typeof vi.fn>;
  exchangePublicToken: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

let seq = 0;
let user: User;
let deviceId: string;
let passkey: Awaited<ReturnType<typeof registerIosPasskey>>;
let client: WatchedClient;
let deps: { db: PrismaClient; plaid: () => Promise<PlaidClient> };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `bank${seq}@example.test`, displayName: "Bank", countryCode: "CA", timezone: "America/Toronto" },
  });
  deviceId = (await issueAppDeviceToken({ user, deviceName: "Sam's iPhone" }, db)).device.id;
  passkey = await registerIosPasskey(db, user.id, RP_ID);
  const base = fake.createFakePlaidClient();
  client = {
    ...base,
    createLinkToken: vi.fn(base.createLinkToken),
    exchangePublicToken: vi.fn(base.exchangePublicToken),
    removeItem: vi.fn(base.removeItem),
  };
  deps = { db, plaid: async () => client };
});

/** Face ID in the app: the server's challenge for this user, signed with their passkey. */
async function faceId(forUserId = user.id) {
  const { challengeId, options } = await createAuthenticationOptions("authenticate", forUserId);
  return { challengeId, response: passkey.assert(options.challenge) as never };
}

function publicToken() {
  seq += 1;
  return `${fake.FAKE_PUBLIC_TOKEN_PREFIX}app-${seq}`;
}

async function startNewBank(stepUp?: Awaited<ReturnType<typeof faceId>>) {
  return lib.startAppBankLink(deps, {
    user,
    appDeviceId: deviceId,
    request: { stepUp: stepUp ?? (await faceId()), mode: "create", historyDays: 90 },
  });
}

describe("connecting a bank from the app", () => {
  it("opens Link after Face ID, sending the bank's sign-in back to the app, and stores what Link returns", async () => {
    const started = await startNewBank();
    if (!started.ok) throw new Error(started.error);
    expect(started.linkToken).toMatch(/^link-/);
    expect(client.createLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({ daysRequested: 90, redirectUri: `https://${RP_ID}/plaid/oauth`, clientUserId: user.id }),
    );

    const finished = await lib.finishAppBankLink(deps, { user, appDeviceId: deviceId, linkId: started.link.id, publicToken: publicToken() });

    expect(finished).toMatchObject({ ok: true, kind: "linked", institutionName: fake.FAKE_INSTITUTION_NAME, accountCount: 3 });
    expect(await db.plaidItem.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.appBankLink.count({ where: { userId: user.id } })).toBe(0);
  });

  it("opens nothing without a fresh Face ID from this user", async () => {
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const forSomeoneElse = await faceId(other.id);
    expect(await startNewBank(forSomeoneElse)).toMatchObject({ ok: false, status: 401 });

    const used = await faceId();
    expect((await startNewBank(used)).ok).toBe(true);
    expect(await startNewBank(used)).toMatchObject({ ok: false, status: 401 });

    expect(client.createLinkToken).toHaveBeenCalledTimes(1);
    expect(await db.appBankLink.count({ where: { userId: user.id } })).toBe(1);
  });

  it("finishes once, only from the phone that started it, and not after it expires", async () => {
    const started = await startNewBank();
    if (!started.ok) throw new Error(started.error);
    const otherPhone = (await issueAppDeviceToken({ user, deviceName: "Old iPhone" }, db)).device.id;
    const finish = (appDeviceId: string, now?: Date) =>
      lib.finishAppBankLink({ ...deps, now }, { user, appDeviceId, linkId: started.link.id, publicToken: publicToken() });

    expect(await finish(otherPhone)).toMatchObject({ ok: false, status: 410 });
    expect(await finish(deviceId, new Date(Date.now() + lib.APP_BANK_LINK_TTL_MS + 1000))).toMatchObject({ ok: false, status: 410 });
    expect(client.exchangePublicToken).not.toHaveBeenCalled();

    expect((await finish(deviceId)).ok).toBe(true);
    expect(await finish(deviceId)).toMatchObject({ ok: false, status: 410 });
    expect(client.exchangePublicToken).toHaveBeenCalledTimes(1);
  });

  it("refuses a second connection to a bank already connected, and ends the new one at Plaid", async () => {
    for (const expected of [true, false]) {
      const started = await startNewBank();
      if (!started.ok) throw new Error(started.error);
      const finished = await lib.finishAppBankLink(deps, { user, appDeviceId: deviceId, linkId: started.link.id, publicToken: publicToken() });
      expect(finished.ok).toBe(expected);
    }
    expect(client.removeItem).toHaveBeenCalledTimes(1);
    expect(await db.plaidItem.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("fixing a bank from the app", () => {
  it("re-reads the connection after Link without exchanging anything, picking up shared accounts", async () => {
    const { linkBank } = await import("@/lib/plaid/connections");
    await linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
    await db.plaidItem.update({ where: { id: item.id }, data: { newAccountsAvailableAt: new Date() } });
    client.exchangePublicToken.mockClear();

    const started = await lib.startAppBankLink(deps, {
      user,
      appDeviceId: deviceId,
      request: { stepUp: await faceId(), mode: "update", plaidItemId: item.id, updateKind: "accounts" },
    });
    if (!started.ok) throw new Error(started.error);
    expect(client.createLinkToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountSelection: true, accessToken: expect.any(String), redirectUri: `https://${RP_ID}/plaid/oauth` }),
    );

    const finished = await lib.finishAppBankLink(deps, { user, appDeviceId: deviceId, linkId: started.link.id });
    expect(finished).toMatchObject({ ok: true, kind: "updated", plaidItemId: item.id, newAccounts: 1 });
    expect(client.exchangePublicToken).not.toHaveBeenCalled();
    expect((await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } })).newAccountsAvailableAt).toBeNull();
  });

  it("will not fix someone else's connection", async () => {
    const started = await lib.startAppBankLink(deps, {
      user,
      appDeviceId: deviceId,
      request: { stepUp: await faceId(), mode: "update", plaidItemId: "not-yours", updateKind: "reauth" },
    });
    expect(started).toMatchObject({ ok: false, status: 404 });
    expect(client.createLinkToken).not.toHaveBeenCalled();
  });
});

describe("the bank sign-in return address", () => {
  it("is sent only by the app's home server", () => {
    expect(lib.plaidOAuthRedirectUri("ABCDE12345.com.example.finances")).toBe(`https://${RP_ID}/plaid/oauth`);
    expect(lib.plaidOAuthRedirectUri(null)).toBeNull();
  });
});

describe("matching bank accounts to the app's accounts", () => {
  it("lists each bank's accounts and fills one with an account in the same currency", async () => {
    const { linkBank } = await import("@/lib/plaid/connections");
    await linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const chequing = await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING", currency: "CAD" } });
    const dollars = await db.account.create({ data: { userId: user.id, name: "US dollars", type: "CHEQUING", currency: "USD" } });

    const screen = await banks.banksForApp(db, user.id, true);
    expect(screen).toMatchObject({ available: true, appLinking: true, hasPasskey: true });
    expect(screen.banks).toHaveLength(1);
    const bankAccount = screen.banks[0].accounts.find((a) => a.currency === "CAD")!;
    expect(bankAccount.accountId).toBeNull();

    expect(await banks.mapBankAccountForApp(db, user.id, bankAccount.id, { accountId: dollars.id })).toMatchObject({ ok: false, status: 400 });
    expect(await banks.mapBankAccountForApp(db, "someone-else", bankAccount.id, { accountId: chequing.id })).toMatchObject({ ok: false, status: 404 });
    expect((await banks.mapBankAccountForApp(db, user.id, bankAccount.id, { accountId: chequing.id })).ok).toBe(true);
    expect((await db.plaidAccount.findUniqueOrThrow({ where: { id: bankAccount.id } })).accountId).toBe(chequing.id);

    expect((await banks.mapBankAccountForApp(db, user.id, bankAccount.id, { accountId: null })).ok).toBe(true);
    expect((await db.plaidAccount.findUniqueOrThrow({ where: { id: bankAccount.id } })).accountId).toBeNull();
  });
});

describe("syncing a bank now from the app", () => {
  it("runs the bank's sync and says what came of it, and a bank that wants a sign-in shows its fix", async () => {
    const { linkBank } = await import("@/lib/plaid/connections");
    const { syncBank } = await import("@/lib/plaid/sync-bank");
    const { createSyncStore } = await import("@/lib/plaid/sync-store");
    const { PlaidApiError } = await import("@/lib/plaid/client");
    await linkBank({ prisma: db, client }, { user, publicToken: publicToken(), days: 90 });
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId: user.id } });
    const syncWith = (c: PlaidClient) => vi.fn((id: string) => syncBank({ client: c, store: createSyncStore(), prisma: db }, id));

    const ok = await banks.syncBankForApp({ db, sync: syncWith(client) }, user.id, item.id);
    expect(ok).toMatchObject({ ok: true, needsSignIn: false, outcome: { kind: "synced" } });
    // Nothing is matched yet, so every row the bank sent was skipped, and the screen says why.
    expect(ok.ok && ok.message).toMatch(/^No new transactions\. \d+ transactions? from accounts set to Not synced (was|were) skipped\.$/);

    const signedOut: PlaidClient = {
      ...client,
      transactionsSync: async () => {
        throw new PlaidApiError({
          message: "the login details of this item have changed",
          errorCode: "ITEM_LOGIN_REQUIRED",
          errorType: "ITEM_ERROR",
          requestId: null,
          httpStatus: 400,
        });
      },
    };
    const refused = await banks.syncBankForApp({ db, sync: syncWith(signedOut) }, user.id, item.id);
    expect(refused).toMatchObject({ ok: true, needsSignIn: true, tone: "warning" });
    const screen = await banks.banksForApp(db, user.id, true);
    expect(screen.banks[0].attention).toMatchObject({ kind: "reauth", updateKind: "reauth", actionLabel: "Sign in again" });

    const notYours = syncWith(client);
    expect(await banks.syncBankForApp({ db, sync: notYours }, "someone-else", item.id)).toMatchObject({ ok: false, status: 404 });
    expect(notYours).not.toHaveBeenCalled();
  });
});

describe("whether the app can connect banks itself", () => {
  it("needs a passkey to confirm with, and a server that names the app", async () => {
    const noPasskey = await db.user.create({ data: { email: `nopasskey${seq}@example.test`, displayName: "None" } });
    expect(await banks.banksForApp(db, noPasskey.id, true)).toMatchObject({ appLinking: true, hasPasskey: false, banks: [] });

    const saved = process.env.APPLE_APP_ID;
    delete process.env.APPLE_APP_ID;
    try {
      expect(await banks.banksForApp(db, user.id, true)).toMatchObject({ appLinking: false, hasPasskey: true });
    } finally {
      process.env.APPLE_APP_ID = saved;
    }
  });
});

describe("parseBankLinkRequest", () => {
  const stepUp = { challengeId: "c1", response: { id: "x" } };

  it("needs Face ID and a history window it offers", () => {
    expect(lib.parseBankLinkRequest({ mode: "create", historyDays: 90 })).toMatchObject({ ok: false });
    expect(lib.parseBankLinkRequest({ stepUp, mode: "create", historyDays: 45 })).toMatchObject({ ok: false });
    expect(lib.parseBankLinkRequest({ stepUp, mode: "create", historyDays: 365 })).toMatchObject({ ok: true, value: { historyDays: 365 } });
    expect(lib.parseBankLinkRequest({ stepUp, mode: "update", plaidItemId: "p1", updateKind: "accounts" })).toMatchObject({
      ok: true,
      value: { mode: "update", updateKind: "accounts" },
    });
  });
});
