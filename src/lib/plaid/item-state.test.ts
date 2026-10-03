import { describe, expect, it } from "vitest";
import { describePlaidItemAttention, type PlaidAttentionInput } from "@/lib/plaid/attention";
import {
  attentionCleared,
  backoffAfterFailure,
  backoffCleared,
  LOGIN_REQUIRED_FALLBACK,
  loginRequired,
  MAX_SYNC_BACKOFF_MINUTES,
  newAccountsHandled,
  parseConsentExpiry,
  plaidSyncBackoffMinutes,
  syncFailed,
  syncSucceeded,
} from "@/lib/plaid/item-state";

const NOW = new Date("2026-10-03T12:00:00Z");

type ItemState = PlaidAttentionInput & {
  errorCode: string | null;
  errorMessage: string | null;
  lastSyncError: string | null;
  consecutiveSyncFailures: number;
  nextSyncAttemptAt: Date | null;
};

/** A connection with every prompt raised and every failure recorded at once. */
function everythingWrong(): ItemState {
  return {
    institutionName: "Test Credit Union",
    status: "LOGIN_REQUIRED",
    errorCode: "ITEM_LOGIN_REQUIRED",
    errorMessage: "Sign in again",
    lastSyncError: "Sign in again",
    consecutiveSyncFailures: 4,
    nextSyncAttemptAt: new Date(NOW.getTime() + 8 * 60 * 60_000),
    consentExpiresAt: new Date("2026-10-20T00:00:00Z"),
    pendingExpirationAt: NOW,
    pendingDisconnectAt: NOW,
    pendingDisconnectReason: "INSTITUTION_MIGRATION",
    newAccountsAvailableAt: NOW,
  };
}

function apply(item: ItemState, update: object): ItemState {
  return { ...item, ...update } as ItemState;
}

describe("attentionCleared", () => {
  it("leaves nothing for the callout to show except new accounts, which has its own flow", () => {
    const after = apply(everythingWrong(), attentionCleared());
    expect(describePlaidItemAttention(after)?.kind).toBe("new-accounts");
    expect(describePlaidItemAttention(apply(after, newAccountsHandled()))).toBeNull();
  });

  it("drops the failure state too, so the next sync is not held back", () => {
    const after = apply(everythingWrong(), attentionCleared());
    expect(after).toMatchObject({
      status: "ACTIVE",
      errorCode: null,
      errorMessage: null,
      lastSyncError: null,
      consecutiveSyncFailures: 0,
      nextSyncAttemptAt: null,
    });
  });
});

describe("loginRequired", () => {
  it("raises the sign-in callout and drops any backoff", () => {
    const healthy = apply(apply(everythingWrong(), attentionCleared()), newAccountsHandled());
    const after = apply({ ...healthy, nextSyncAttemptAt: NOW }, loginRequired("Please sign in"));
    expect(describePlaidItemAttention(after)?.kind).toBe("reauth");
    expect(after).toMatchObject({ errorMessage: "Please sign in", nextSyncAttemptAt: null });
  });

  it("falls back to a readable message when the bank sends none", () => {
    expect(loginRequired(undefined).errorMessage).toBe(LOGIN_REQUIRED_FALLBACK);
    expect(loginRequired("").errorMessage).toBe(LOGIN_REQUIRED_FALLBACK);
  });
});

describe("sync outcomes", () => {
  it("a failure that needs a sign-in is the same state a webhook would raise", () => {
    const fromSync = syncFailed({ error: "Sign in again", needsReauth: true });
    expect(fromSync).toMatchObject(loginRequired("Sign in again"));
    expect(fromSync.lastSyncError).toBe("Sign in again");
  });

  it("an ordinary failure records the error but raises no sign-in prompt", () => {
    const fromSync = syncFailed({ error: "network down", needsReauth: false });
    expect(fromSync).toEqual({ lastSyncError: "network down", errorMessage: "network down" });
  });

  it("a success clears the last error and stamps the initial walk only once", () => {
    expect(syncSucceeded({ now: NOW, completedInitialSync: false, earliestObserved: NOW })).toEqual({
      lastSyncedAt: NOW,
      lastSyncError: null,
      errorMessage: null,
    });
    const earliest = new Date("2026-07-01T00:00:00Z");
    expect(syncSucceeded({ now: NOW, completedInitialSync: true, earliestObserved: earliest })).toMatchObject({
      initialSyncDoneAt: NOW,
      earliestObservedAt: earliest,
    });
  });
});

describe("backoff", () => {
  it("records the failure count and the next attempt together", () => {
    expect(backoffAfterFailure(3, NOW)).toEqual({
      consecutiveSyncFailures: 3,
      nextSyncAttemptAt: new Date(NOW.getTime() + 240 * 60_000),
    });
    expect(backoffCleared()).toEqual({ consecutiveSyncFailures: 0, nextSyncAttemptAt: null });
  });
});

describe("parseConsentExpiry", () => {
  it("reads Plaid's timestamp and treats anything else as no expiry", () => {
    expect(parseConsentExpiry("2026-12-01T00:00:00Z")).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(parseConsentExpiry(null)).toBeNull();
    expect(parseConsentExpiry(undefined)).toBeNull();
    expect(parseConsentExpiry("")).toBeNull();
    expect(parseConsentExpiry("not a date")).toBeNull();
    expect(parseConsentExpiry(42)).toBeNull();
  });
});

describe("plaidSyncBackoffMinutes", () => {
  it("doubles per consecutive failure, starting at the normal interval", () => {
    expect(plaidSyncBackoffMinutes(1)).toBe(60);
    expect(plaidSyncBackoffMinutes(2)).toBe(120);
    expect(plaidSyncBackoffMinutes(3)).toBe(240);
    expect(plaidSyncBackoffMinutes(4)).toBe(480);
  });

  it("caps at a day, so a connection fixed later is still picked up promptly", () => {
    // 60 · 2^4 = 960, still under the cap; the cap first bites on the sixth failure.
    expect(plaidSyncBackoffMinutes(5)).toBe(960);
    expect(plaidSyncBackoffMinutes(6)).toBe(MAX_SYNC_BACKOFF_MINUTES);
    expect(plaidSyncBackoffMinutes(50)).toBe(MAX_SYNC_BACKOFF_MINUTES);
    // No overflow from a runaway counter.
    expect(Number.isFinite(plaidSyncBackoffMinutes(10_000))).toBe(true);
    expect(plaidSyncBackoffMinutes(10_000)).toBe(MAX_SYNC_BACKOFF_MINUTES);
  });

  it("treats a first failure and a zeroed counter the same", () => {
    expect(plaidSyncBackoffMinutes(0)).toBe(60);
    expect(plaidSyncBackoffMinutes(-3)).toBe(60);
  });

  it("turns a permanently broken bank from 24 calls a day into 1", () => {
    // The whole point: a connection nobody fixes must stop costing rate limit, and on
    // per-request pricing, money.
    const callsPerDayAtCap = (24 * 60) / plaidSyncBackoffMinutes(6);
    expect(callsPerDayAtCap).toBe(1);
  });
});
