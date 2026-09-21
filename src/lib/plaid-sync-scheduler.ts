import { PlaidItemStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PlaidApiError } from "@/lib/plaid/client";
import { getPlaidConfig, getPlaidSweepEnabled } from "@/lib/plaid/config";
import { plaidSweepSwitchEnabled } from "@/lib/plaid/settings";
import { requirePlaidClient } from "@/lib/plaid/service";
import { PlaidSyncBusyError, syncPlaidItem } from "@/lib/plaid/sync";
import { createSyncStore } from "@/lib/plaid/sync-store";

/**
 * In-process sweep that pulls new transactions for connected banks.
 *
 * The app is a single Node process with no external job runner, so this lives here and is
 * started once from `instrumentation.ts` — the same arrangement, for the same reason, as
 * the recurring auto-post sweep next door.
 *
 * Nothing it fetches is posted anywhere. Synced rows land in the review queue and wait for
 * a person, so a sweep that runs while nobody is looking cannot change anyone's books. All
 * it does is make the queue already be there when they next open the dashboard.
 */

export const DEFAULT_PLAID_SYNC_INTERVAL_MINUTES = 60;

/**
 * Below this, a sweep stops being a background refresh and starts being a way to burn
 * through Plaid's rate limits on an account that sees a handful of transactions a day.
 */
export const MIN_PLAID_SYNC_INTERVAL_MINUTES = 15;

const INITIAL_DELAY_MS = 45 * 1000;

const globalState = globalThis as unknown as { __plaidSyncScheduler?: boolean };

/**
 * `PLAID_SYNC_SCHEDULER=false` (or `0`) turns the sweep off; anything else leaves it on.
 *
 * This is the environment half only, and it is checked once at boot because an env var
 * cannot change under a running process. The other half — **Settings → Server admin →
 * Plaid → Sync connected banks in the background** — is stored in the database and so is
 * re-read on every tick, which is what lets an admin stop the sweep without a restart.
 */
export function plaidSyncSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return plaidSweepSwitchEnabled(env.PLAID_SYNC_SCHEDULER);
}

/**
 * How often the sweep runs, in minutes.
 *
 * Anything unparseable, zero, negative, or below the floor falls back to the default
 * rather than being clamped up to the floor: a value that was meant to say something and
 * could not be honoured is better treated as unset than silently reinterpreted.
 */
export function resolvePlaidSyncIntervalMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PLAID_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return DEFAULT_PLAID_SYNC_INTERVAL_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_PLAID_SYNC_INTERVAL_MINUTES) {
    return DEFAULT_PLAID_SYNC_INTERVAL_MINUTES;
  }
  return parsed;
}

/**
 * The cutoff the sweep selects on: a bank is due when it has never synced, or last synced
 * strictly before this.
 *
 * Exported so the rule is tested where it is actually used, rather than a second copy of
 * it living in a helper the query does not call.
 */
export function plaidSyncDueBefore(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() - intervalMinutes * 60_000);
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

export type SweepSummary = {
  considered: number;
  synced: number;
  staged: number;
  busy: number;
  needsReauth: number;
  failed: number;
};

/**
 * Syncs every connected bank that is due.
 *
 * Only `ACTIVE` items are considered: one waiting on re-authentication will fail every
 * time until a person signs in again, and hammering it hourly achieves nothing but log
 * noise and rate-limit pressure. Items are synced one at a time rather than in parallel —
 * SQLite takes a write lock per commit, and a burst of concurrent syncs would contend with
 * whatever the user is doing in the app right now.
 */
export type SweepOptions = {
  /**
   * Restrict the sweep to one user's banks.
   *
   * The scheduled sweep passes nothing and covers everyone. Scoping exists so a caller can
   * refresh a single account's connections without touching anyone else's — and it is what
   * lets the sweep be tested hermetically, since an unscoped sweep in a parallel test run
   * will happily pick up another spec's bank, take its sync lock and advance its cursor.
   */
  userId?: string;
};

export async function sweepDuePlaidItems(
  now = new Date(),
  options: SweepOptions = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = {
    considered: 0,
    synced: 0,
    staged: 0,
    busy: 0,
    needsReauth: 0,
    failed: 0,
  };

  // Cheap exit when Plaid is not set up at all, which is the common case for most
  // self-hosted deployments and should cost one cached config read, not a table scan.
  if ((await getPlaidConfig()) === null) return summary;

  const intervalMinutes = resolvePlaidSyncIntervalMinutes();
  const dueBefore = plaidSyncDueBefore(now, intervalMinutes);

  // Every clause here exists to avoid paying for a call that cannot produce anything.
  // Served by @@index([status, lastSyncedAt]).
  const due = await prisma.plaidItem.findMany({
    where: {
      status: PlaidItemStatus.ACTIVE,
      ...(options.userId ? { userId: options.userId } : {}),
      // At least one account actually feeding somewhere. Without this, a bank the user
      // connected but never mapped is fetched every hour and stages precisely nothing.
      plaidAccounts: { some: { accountId: { not: null }, syncEnabled: true } },
      // Each nullable column is compared as an explicit "null OR in range" pair rather
      // than a NOT. In SQL, `NOT (col < x)` is NULL — not true — when col is NULL, so a
      // NOT here would have excluded every bank that has no consent expiry, which is
      // nearly all of them, and quietly disabled the whole sweep.
      AND: [
        { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }] },
        { OR: [{ nextSyncAttemptAt: null }, { nextSyncAttemptAt: { lte: now } }] },
        { OR: [{ consentExpiresAt: null }, { consentExpiresAt: { gte: now } }] },
      ],
    },
    select: { id: true, institutionName: true },
    orderBy: { lastSyncedAt: "asc" },
  });
  summary.considered = due.length;
  if (due.length === 0) return summary;

  const client = await requirePlaidClient();
  const store = createSyncStore();

  for (const item of due) {
    try {
      const result = await syncPlaidItem({ client, store }, item.id);
      summary.synced += 1;
      summary.staged += result.staged;
      await clearBackoff(item.id);
    } catch (err) {
      if (err instanceof PlaidSyncBusyError) {
        // Someone pressed "Sync now" for this bank, or a previous sweep is still going.
        // Not a failure; it will be picked up next time and must not count towards backoff.
        summary.busy += 1;
        continue;
      }
      if (err instanceof PlaidApiError && err.needsReauth) {
        // `syncPlaidItem` has already flipped the item to LOGIN_REQUIRED, so it drops out
        // of the next sweep until the user signs in again — no backoff needed.
        summary.needsReauth += 1;
        continue;
      }
      // One bank's problem must not stop the others.
      summary.failed += 1;
      await recordBackoff(item.id, now);
      console.error(`[plaid] sync failed for ${item.institutionName ?? item.id}`, err);
    }
  }

  return summary;
}

/** A successful sync clears any backoff, so the next failure starts from one hour again. */
async function clearBackoff(itemId: string): Promise<void> {
  await prisma.plaidItem.updateMany({
    where: { id: itemId, OR: [{ consecutiveSyncFailures: { gt: 0 } }, { nextSyncAttemptAt: { not: null } }] },
    data: { consecutiveSyncFailures: 0, nextSyncAttemptAt: null },
  });
}

/** Pushes the next attempt out, further each time this bank fails in a row. */
async function recordBackoff(itemId: string, now: Date): Promise<void> {
  const current = await prisma.plaidItem.findUnique({
    where: { id: itemId },
    select: { consecutiveSyncFailures: true },
  });
  const failures = (current?.consecutiveSyncFailures ?? 0) + 1;
  await prisma.plaidItem.update({
    where: { id: itemId },
    data: {
      consecutiveSyncFailures: failures,
      nextSyncAttemptAt: new Date(now.getTime() + plaidSyncBackoffMinutes(failures) * 60_000),
    },
  });
}

export function startPlaidSyncScheduler(): boolean {
  if (globalState.__plaidSyncScheduler) return false;
  if (!plaidSyncSchedulerEnabled()) return false;
  globalState.__plaidSyncScheduler = true;

  const intervalMs = resolvePlaidSyncIntervalMinutes() * 60_000;

  const sweep = async () => {
    try {
      // Re-read per tick rather than per boot: the admin switch lives in the database
      // precisely so turning the sweep off does not mean restarting the container. Costs
      // one cached-config check, which is the same query the sweep would make anyway.
      if (!(await getPlaidSweepEnabled())) return;
      const summary = await sweepDuePlaidItems();
      if (summary.synced > 0 || summary.failed > 0) {
        console.log(
          `[plaid] swept ${summary.synced}/${summary.considered} bank(s), staged ${summary.staged}` +
            (summary.needsReauth > 0 ? `, ${summary.needsReauth} need re-authentication` : "") +
            (summary.failed > 0 ? `, ${summary.failed} failed` : ""),
        );
      }
    } catch (err) {
      console.error("[plaid] sync sweep failed", err);
    }
  };

  // `unref` so a pending timer never keeps a shutting-down process alive.
  setTimeout(() => void sweep(), INITIAL_DELAY_MS).unref();
  setInterval(() => void sweep(), intervalMs).unref();
  return true;
}
