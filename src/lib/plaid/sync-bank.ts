import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { DEFAULT_PLAID_SYNC_INTERVAL_MINUTES } from "@/lib/ops-settings";
import { PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import { requirePlaidClient } from "@/lib/plaid/service";
import { createSyncStore } from "@/lib/plaid/sync-store";
import { PlaidSyncBusyError, syncPlaidItem, type SyncStore, type SyncSummary } from "@/lib/plaid/sync";
import { ensurePlaidItemWebhook } from "@/lib/plaid/webhooks";

/**
 * Syncing one bank, whoever asked for it.
 *
 * "Sync now" and the background sweep both come through here, so a bank ends up in the same
 * state either way. Before this existed the sweep alone kept the failure backoff, which meant
 * a manual sync that succeeded left the bank parked in backoff, and one that failed never
 * counted towards it.
 *
 * Callers only decide what to *say* about the outcome (an audit row, a message, a count).
 * Everything written to the item happens here or in `syncPlaidItem`.
 */

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

export type SyncBankOutcome =
  | { kind: "synced"; summary: SyncSummary }
  /** Another sync holds the lock. Not a failure, and never counted towards backoff. */
  | { kind: "busy"; error: PlaidSyncBusyError }
  /**
   * The bank wants the user to sign in again. `syncPlaidItem` has already flipped the item
   * to LOGIN_REQUIRED, which the sweep skips, so no backoff is needed either.
   */
  | { kind: "needs-reauth"; error: PlaidApiError }
  | { kind: "failed"; error: unknown };

export type SyncBankDeps = {
  client: PlaidClient;
  store: SyncStore;
  prisma: Pick<PrismaClient, "plaidItem">;
};

/** The real dependencies. Resolved once per caller, so a sweep shares one client and store. */
export async function createSyncBankDeps(): Promise<SyncBankDeps> {
  return { client: await requirePlaidClient(), store: createSyncStore(), prisma: defaultPrisma };
}

/**
 * Syncs one bank and records the outcome on it. Never throws for a failure of the sync
 * itself; the outcome says what happened.
 */
export async function syncBank(
  deps: SyncBankDeps,
  itemId: string,
  now: Date = new Date(),
): Promise<SyncBankOutcome> {
  // Re-points banks linked before webhooks existed. Best-effort and at most one call per
  // item per URL change; it never fails the sync behind it.
  await ensurePlaidItemWebhook({ prisma: deps.prisma, client: deps.client }, itemId);

  try {
    const summary = await syncPlaidItem({ client: deps.client, store: deps.store }, itemId);
    await clearBackoff(deps.prisma, itemId);
    return { kind: "synced", summary };
  } catch (err) {
    if (err instanceof PlaidSyncBusyError) return { kind: "busy", error: err };
    if (err instanceof PlaidApiError && err.needsReauth) return { kind: "needs-reauth", error: err };
    await recordBackoff(deps.prisma, itemId, now);
    return { kind: "failed", error: err };
  }
}

/** A successful sync clears any backoff, so the next failure starts from one hour again. */
async function clearBackoff(db: SyncBankDeps["prisma"], itemId: string): Promise<void> {
  await db.plaidItem.updateMany({
    where: { id: itemId, OR: [{ consecutiveSyncFailures: { gt: 0 } }, { nextSyncAttemptAt: { not: null } }] },
    data: { consecutiveSyncFailures: 0, nextSyncAttemptAt: null },
  });
}

/** Pushes the next attempt out, further each time this bank fails in a row. */
async function recordBackoff(db: SyncBankDeps["prisma"], itemId: string, now: Date): Promise<void> {
  const current = await db.plaidItem.findUnique({
    where: { id: itemId },
    select: { consecutiveSyncFailures: true },
  });
  // The bank was unlinked while it synced; there is nothing left to back off.
  if (!current) return;
  const failures = current.consecutiveSyncFailures + 1;
  await db.plaidItem.update({
    where: { id: itemId },
    data: {
      consecutiveSyncFailures: failures,
      nextSyncAttemptAt: new Date(now.getTime() + plaidSyncBackoffMinutes(failures) * 60_000),
    },
  });
}
