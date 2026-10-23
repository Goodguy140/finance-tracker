/**
 * What each in-process scheduler last did, for the admin Operations page.
 *
 * Held in memory on `globalThis` (the same place the schedulers keep their started flags,
 * so it survives Turbopack module re-evaluation) and deliberately not persisted: after a
 * restart the honest answer is "has not run since boot", and a table written every tick
 * would be one more thing to prune.
 */

export type SchedulerName = "plaidSync" | "recurringAutoPost" | "emailDigest";

export type SchedulerHeartbeat = {
  startedAt: string;
  lastRunAt: string | null;
  /** One line: what the tick did, why it skipped, or the error it hit. */
  lastResult: string | null;
  lastOk: boolean | null;
  nextRunAt: string | null;
};

type Store = Partial<Record<SchedulerName, SchedulerHeartbeat>>;

const globalState = globalThis as unknown as { __schedulerHeartbeats?: Store };

function store(): Store {
  if (!globalState.__schedulerHeartbeats) globalState.__schedulerHeartbeats = {};
  return globalState.__schedulerHeartbeats;
}

export function markSchedulerStarted(name: SchedulerName, nextRunAt: Date, now = new Date()): void {
  store()[name] = {
    startedAt: now.toISOString(),
    lastRunAt: null,
    lastResult: null,
    lastOk: null,
    nextRunAt: nextRunAt.toISOString(),
  };
}

export function recordSchedulerRun(
  name: SchedulerName,
  result: { ok: boolean; message: string; nextRunAt: Date | null },
  now = new Date(),
): void {
  const current = store()[name];
  store()[name] = {
    startedAt: current?.startedAt ?? now.toISOString(),
    lastRunAt: now.toISOString(),
    lastResult: result.message,
    lastOk: result.ok,
    nextRunAt: result.nextRunAt?.toISOString() ?? null,
  };
}

/** Null means the scheduler never started in this process (disabled by env, or not booted). */
export function getSchedulerHeartbeat(name: SchedulerName): SchedulerHeartbeat | null {
  return store()[name] ?? null;
}
