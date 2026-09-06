import { autoPostDueRecurringTransactionsForAllUsers } from "@/lib/recurring-post";

/**
 * In-process scheduler for `AUTO` recurring rules.
 *
 * The app is a single Node process with no external job runner, so the hourly sweep runs
 * here, started once from `instrumentation.ts`. The dashboard also posts a user's own due
 * rules on load, so this mostly matters for accounts nobody opens for a while (and for
 * budget alert emails, which only fire from a spending change).
 */

const INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;

const globalState = globalThis as unknown as { __recurringAutoPostScheduler?: boolean };

export function recurringAutoPostSchedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.RECURRING_AUTO_POST_SCHEDULER?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

export function startRecurringAutoPostScheduler(): boolean {
  if (globalState.__recurringAutoPostScheduler) return false;
  if (!recurringAutoPostSchedulerEnabled()) return false;
  globalState.__recurringAutoPostScheduler = true;

  const sweep = async () => {
    try {
      const posted = await autoPostDueRecurringTransactionsForAllUsers();
      if (posted > 0) console.log(`[recurring] auto-posted ${posted} occurrence(s)`);
    } catch (err) {
      console.error("[recurring] auto-post sweep failed", err);
    }
  };
  // `unref` so a pending timer never keeps a shutting-down process alive.
  setTimeout(() => void sweep(), INITIAL_DELAY_MS).unref();
  setInterval(() => void sweep(), INTERVAL_MS).unref();
  return true;
}
