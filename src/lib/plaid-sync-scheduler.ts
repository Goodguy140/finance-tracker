import { PlaidItemStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PlaidApiError } from "@/lib/plaid/client";
import { getPlaidConfig } from "@/lib/plaid/config";
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

/** `PLAID_SYNC_SCHEDULER=false` (or `0`) turns the sweep off; anything else leaves it on. */
export function plaidSyncSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.PLAID_SYNC_SCHEDULER?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
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
export async function sweepDuePlaidItems(now = new Date()): Promise<SweepSummary> {
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

  // Served by @@index([status, lastSyncedAt]).
  const due = await prisma.plaidItem.findMany({
    where: {
      status: PlaidItemStatus.ACTIVE,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
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
    } catch (err) {
      if (err instanceof PlaidSyncBusyError) {
        // Someone pressed "Sync now" for this bank, or a previous sweep is still going.
        // Not a failure; it will be picked up next time.
        summary.busy += 1;
        continue;
      }
      if (err instanceof PlaidApiError && err.needsReauth) {
        // `syncPlaidItem` has already flipped the item to LOGIN_REQUIRED, so it drops out
        // of the next sweep until the user signs in again.
        summary.needsReauth += 1;
        continue;
      }
      // One bank's problem must not stop the others.
      summary.failed += 1;
      console.error(`[plaid] sync failed for ${item.institutionName ?? item.id}`, err);
    }
  }

  return summary;
}

export function startPlaidSyncScheduler(): boolean {
  if (globalState.__plaidSyncScheduler) return false;
  if (!plaidSyncSchedulerEnabled()) return false;
  globalState.__plaidSyncScheduler = true;

  const intervalMs = resolvePlaidSyncIntervalMinutes() * 60_000;

  const sweep = async () => {
    try {
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
