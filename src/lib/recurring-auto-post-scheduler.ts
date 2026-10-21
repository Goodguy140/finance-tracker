import { getRecurringAutoPostEnabled } from "@/lib/ops-settings";
import { autoPostDueRecurringTransactionsForAllUsers } from "@/lib/recurring-post";
import { markSchedulerStarted, recordSchedulerRun } from "@/lib/scheduler-status";

/**
 * In-process scheduler for `AUTO` recurring rules.
 *
 * The app is a single Node process with no external job runner, so the hourly sweep runs
 * here, started once from `instrumentation.ts`. The dashboard also posts a user's own due
 * rules on load, so this mostly matters for accounts nobody opens for a while. What it
 * posts schedules budget alert emails (`autoPostDueRecurringTransactions`), so a user who
 * never opens the app still hears when a bill tips a category over.
 */

const INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;

const globalState = globalThis as unknown as { __recurringAutoPostScheduler?: boolean };

/**
 * The environment half of the switch, checked once at boot. The admin half (Operations →
 * Post recurring rules automatically) is re-read on every tick, so it can pause the sweep
 * without a restart.
 */
export function recurringAutoPostSchedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.RECURRING_AUTO_POST_SCHEDULER?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

/**
 * One tick. Exported so the admin switch is tested where it is actually consulted, rather
 * than in a copy of the rule.
 */
export async function runRecurringAutoPostTick(deps: {
  enabled: () => Promise<boolean>;
  post: () => Promise<number>;
} = { enabled: getRecurringAutoPostEnabled, post: autoPostDueRecurringTransactionsForAllUsers }): Promise<{
  ok: boolean;
  message: string;
  posted: number;
}> {
  if (!(await deps.enabled())) {
    return { ok: true, message: "Skipped: switched off in Operations", posted: 0 };
  }
  const posted = await deps.post();
  return { ok: true, message: `Posted ${posted} occurrence(s)`, posted };
}

export function startRecurringAutoPostScheduler(): boolean {
  if (globalState.__recurringAutoPostScheduler) return false;
  if (!recurringAutoPostSchedulerEnabled()) return false;
  globalState.__recurringAutoPostScheduler = true;

  const sweep = async () => {
    const nextRunAt = new Date(Date.now() + INTERVAL_MS);
    try {
      const result = await runRecurringAutoPostTick();
      if (result.posted > 0) console.log(`[recurring] auto-posted ${result.posted} occurrence(s)`);
      recordSchedulerRun("recurringAutoPost", { ok: result.ok, message: result.message, nextRunAt });
    } catch (err) {
      console.error("[recurring] auto-post sweep failed", err);
      recordSchedulerRun("recurringAutoPost", {
        ok: false,
        message: err instanceof Error ? err.message : "Sweep failed",
        nextRunAt,
      });
    }
  };
  // `unref` so a pending timer never keeps a shutting-down process alive.
  markSchedulerStarted("recurringAutoPost", new Date(Date.now() + INITIAL_DELAY_MS));
  setTimeout(() => void sweep(), INITIAL_DELAY_MS).unref();
  setInterval(() => void sweep(), INTERVAL_MS).unref();
  return true;
}
