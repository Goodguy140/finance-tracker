import { PlaidItemStatus, type Prisma } from "@prisma/client";
import { DEFAULT_PLAID_SYNC_INTERVAL_MINUTES } from "@/lib/ops-settings";

/**
 * Every change to a bank connection's *state*, named.
 *
 * A `PlaidItem` carries a handful of columns that together say whether the connection is
 * healthy and what, if anything, it needs from its user: `status`, the error columns, the
 * pending-expiration / pending-disconnect / new-accounts prompts, the sync outcome and the
 * failure backoff. `describePlaidItemAttention` reads them; linking, update mode, the sync,
 * the sweep and webhooks write them. When each writer composed its own set of columns, they
 * disagreed about what "fixed" meant: one re-authentication path cleared the error but left
 * the expiry prompt and the backoff behind.
 *
 * So writers do not compose columns. They pick a transition from here, each a pure function
 * returning the update to apply, and `item-state.test.ts` checks the transitions against what
 * the attention callout then shows. A new attention column means changing this file, which is
 * the one place that has to know about it.
 */

type ItemUpdate = Prisma.PlaidItemUpdateInput;

/** Plaid's `consent_expiration_time` as a date. Anything missing or unreadable is "none". */
export function parseConsentExpiry(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A person has dealt with the connection: update mode completed, Plaid reported the login
 * repaired, or the bank was linked afresh. Every prompt and every sign of failure goes,
 * including the backoff, so the next sync is not held back by problems already solved.
 *
 * New accounts are deliberately not cleared here: a plain re-authentication does not answer
 * that prompt. Account selection does, and adds `newAccountsHandled` on top.
 */
export function attentionCleared() {
  return {
    status: PlaidItemStatus.ACTIVE,
    errorCode: null,
    errorMessage: null,
    lastSyncError: null,
    consecutiveSyncFailures: 0,
    nextSyncAttemptAt: null,
    pendingExpirationAt: null,
    pendingDisconnectAt: null,
    pendingDisconnectReason: null,
  } satisfies ItemUpdate;
}

/** The user chose which of the bank's accounts to share, answering NEW_ACCOUNTS_AVAILABLE. */
export function newAccountsHandled() {
  return { newAccountsAvailableAt: null } satisfies ItemUpdate;
}

export const LOGIN_REQUIRED_FALLBACK =
  "Your bank needs you to sign in again before it will share new transactions.";

/**
 * The bank wants the user to sign in again. Nothing syncs until they do, and the sweep skips
 * anything not ACTIVE, so a pending backoff is dropped: it could only delay the first sync
 * after the user fixes it.
 */
export function loginRequired(message: string | null | undefined) {
  return {
    status: PlaidItemStatus.LOGIN_REQUIRED,
    errorCode: "ITEM_LOGIN_REQUIRED",
    errorMessage: message || LOGIN_REQUIRED_FALLBACK,
    nextSyncAttemptAt: null,
  } satisfies ItemUpdate;
}

/** A completed walk of /transactions/sync. */
export function syncSucceeded(input: {
  now: Date;
  /** True on the first full walk, which is the only one that sees the whole history window. */
  completedInitialSync: boolean;
  earliestObserved: Date | null;
}) {
  return {
    lastSyncedAt: input.now,
    lastSyncError: null,
    errorMessage: null,
    ...(input.completedInitialSync
      ? {
          initialSyncDoneAt: input.now,
          ...(input.earliestObserved ? { earliestObservedAt: input.earliestObserved } : {}),
        }
      : {}),
  } satisfies ItemUpdate;
}

/**
 * A walk that failed. The error is recorded where the connections panel shows it; a sign-in
 * problem also flips the item to LOGIN_REQUIRED. `lastSyncedAt` keeps its old value, since
 * that is the last time the data actually came through.
 */
export function syncFailed(input: { error: string; needsReauth: boolean }) {
  return {
    lastSyncError: input.error,
    ...(input.needsReauth ? { ...loginRequired(input.error) } : { errorMessage: input.error }),
  } satisfies ItemUpdate;
}

/** Caps the backoff so a connection fixed days later is still picked up promptly. */
export const MAX_SYNC_BACKOFF_MINUTES = 24 * 60;

/**
 * How long to wait before trying a failing bank again.
 *
 * Doubles per consecutive failure from one hour, capped at a day. A connection that is
 * broken until a person fixes it therefore costs one call a day instead of twenty-four,
 * while a one-off network blip is retried within the hour.
 */
export function plaidSyncBackoffMinutes(consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const minutes = DEFAULT_PLAID_SYNC_INTERVAL_MINUTES * 2 ** Math.min(exponent, 10);
  return Math.min(minutes, MAX_SYNC_BACKOFF_MINUTES);
}

/** A sync got through, so the next failure starts from one hour again. */
export function backoffCleared() {
  return { consecutiveSyncFailures: 0, nextSyncAttemptAt: null } satisfies ItemUpdate;
}

/** Another failure in a row: push the next attempt out further. */
export function backoffAfterFailure(consecutiveFailures: number, now: Date) {
  return {
    consecutiveSyncFailures: consecutiveFailures,
    nextSyncAttemptAt: new Date(now.getTime() + plaidSyncBackoffMinutes(consecutiveFailures) * 60_000),
  } satisfies ItemUpdate;
}
