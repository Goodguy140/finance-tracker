import { PlaidItemStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlaidConfig, getPlaidSweepEnabled } from "@/lib/plaid/config";
import { plaidSweepSwitchEnabled } from "@/lib/plaid/settings";
import { createSyncBankDeps, syncBank } from "@/lib/plaid/sync-bank";
import {
  DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
  MIN_PLAID_SYNC_INTERVAL_MINUTES,
  getPlaidSyncIntervalMinutes,
  resolvePlaidSyncInterval,
} from "@/lib/ops-settings";
import { markSchedulerStarted, recordSchedulerRun } from "@/lib/scheduler-status";

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

// The interval's bounds live with the setting, which the admin form validates against too.
export { DEFAULT_PLAID_SYNC_INTERVAL_MINUTES, MIN_PLAID_SYNC_INTERVAL_MINUTES };

const INITIAL_DELAY_MS = 45 * 1000;

const globalState = globalThis as unknown as { __plaidSyncScheduler?: boolean };

/**
 * `PLAID_SYNC_SCHEDULER=false` (or `0`) turns the sweep off; anything else leaves it on.
 *
 * This is the environment half only, and it is checked once at boot because an env var
 * cannot change under a running process. The other half — **Server admin → Integrations →
 * Plaid → Sync connected banks in the background** — is stored in the database and so is
 * re-read on every tick, which is what lets an admin stop the sweep without a restart.
 */
export function plaidSyncSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return plaidSweepSwitchEnabled(env.PLAID_SYNC_SCHEDULER);
}

/**
 * How often the sweep runs according to the environment alone, in minutes.
 *
 * Anything unparseable, zero, negative, or below the floor falls back to the default
 * rather than being clamped up to the floor: a value that was meant to say something and
 * could not be honoured is better treated as unset than silently reinterpreted. The value
 * actually in effect also considers the admin setting — see `getPlaidSyncIntervalMinutes`.
 */
export function resolvePlaidSyncIntervalMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  return resolvePlaidSyncInterval({ envRaw: env.PLAID_SYNC_INTERVAL_MINUTES, storedRaw: null }).value;
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
  /**
   * How long since its last sync a bank must be before it is due, in place of the configured
   * interval. Only ever shortens it: a person pressing refresh in the log should see the
   * banks checked, not be told the hourly sweep got there first, while a value longer than
   * the configured interval would just make the refresh do less than the sweep does.
   */
  intervalMinutes?: number;
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

  const configuredMinutes = await getPlaidSyncIntervalMinutes();
  const intervalMinutes = Math.min(configuredMinutes, options.intervalMinutes ?? configuredMinutes);
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

  const deps = await createSyncBankDeps();

  for (const item of due) {
    const outcome = await syncBank(deps, item.id, now);
    switch (outcome.kind) {
      case "synced":
        summary.synced += 1;
        summary.staged += outcome.summary.staged;
        break;
      case "busy":
        // Someone pressed "Sync now" for this bank, or a previous sweep is still going.
        // It will be picked up next time.
        summary.busy += 1;
        break;
      case "needs-reauth":
        // Now LOGIN_REQUIRED, so it drops out of the sweep until the user signs in again.
        summary.needsReauth += 1;
        break;
      case "failed":
        // One bank's problem must not stop the others; `syncBank` has already backed it off.
        summary.failed += 1;
        console.error(`[plaid] sync failed for ${item.institutionName ?? item.id}`, outcome.error);
        break;
    }
  }

  return summary;
}

/** Delay before the next tick. Falls back to the default if the settings read fails. */
async function nextTickDelayMs(): Promise<number> {
  try {
    return (await getPlaidSyncIntervalMinutes()) * 60_000;
  } catch {
    return DEFAULT_PLAID_SYNC_INTERVAL_MINUTES * 60_000;
  }
}

export function startPlaidSyncScheduler(): boolean {
  if (globalState.__plaidSyncScheduler) return false;
  if (!plaidSyncSchedulerEnabled()) return false;
  globalState.__plaidSyncScheduler = true;

  const sweep = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      // Re-read per tick rather than per boot: the admin switch lives in the database
      // precisely so turning the sweep off does not mean restarting the container. Costs
      // one cached-config check, which is the same query the sweep would make anyway.
      if (!(await getPlaidSweepEnabled())) return { ok: true, message: "Skipped: sweep switched off or Plaid not configured" };
      const summary = await sweepDuePlaidItems();
      if (summary.synced > 0 || summary.failed > 0) {
        console.log(
          `[plaid] swept ${summary.synced}/${summary.considered} bank(s), staged ${summary.staged}` +
            (summary.needsReauth > 0 ? `, ${summary.needsReauth} need re-authentication` : "") +
            (summary.failed > 0 ? `, ${summary.failed} failed` : ""),
        );
      }
      return {
        ok: summary.failed === 0,
        message:
          `Synced ${summary.synced} of ${summary.considered} due bank(s), staged ${summary.staged}` +
          (summary.failed > 0 ? `, ${summary.failed} failed` : ""),
      };
    } catch (err) {
      console.error("[plaid] sync sweep failed", err);
      return { ok: false, message: err instanceof Error ? err.message : "Sweep failed" };
    }
  };

  // A chain of timeouts rather than one setInterval, so the delay is re-read after every
  // tick and an interval changed in the admin UI takes effect without a restart.
  // `unref` so a pending timer never keeps a shutting-down process alive.
  const tick = async () => {
    const result = await sweep();
    const delayMs = await nextTickDelayMs();
    const nextRunAt = new Date(Date.now() + delayMs);
    recordSchedulerRun("plaidSync", { ...result, nextRunAt });
    setTimeout(() => void tick(), delayMs).unref();
  };
  markSchedulerStarted("plaidSync", new Date(Date.now() + INITIAL_DELAY_MS));
  setTimeout(() => void tick(), INITIAL_DELAY_MS).unref();
  return true;
}
