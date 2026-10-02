import type { SweepSummary } from "@/lib/plaid-sync-scheduler";
import { MIN_PLAID_SYNC_INTERVAL_MINUTES } from "@/lib/ops-settings";

/**
 * The refresh control on the transaction log.
 *
 * It runs the user's own sweep with the interval cut to the floor the admin setting allows,
 * so pressing it checks any bank that has not been checked in the last few minutes instead
 * of quietly doing nothing until the hourly sweep is due. Banks in failure backoff, awaiting
 * re-authentication or past their consent are still skipped: nothing could come of them,
 * and they say so in Settings. Nothing it finds is posted; rows land in the review queue.
 */
export const LOG_REFRESH_INTERVAL_MINUTES = MIN_PLAID_SYNC_INTERVAL_MINUTES;

export type LogRefreshResult = { ok: true; tone: "success" | "neutral" | "warning"; message: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sentence (or two) a person can read next to the refresh icon. */
export function describeLogRefresh(summary: SweepSummary): LogRefreshResult {
  if (summary.considered === 0) {
    return {
      ok: true,
      tone: "neutral",
      message: `Your banks were checked in the last ${LOG_REFRESH_INTERVAL_MINUTES} minutes, or need attention in Settings.`,
    };
  }

  const parts: string[] = [];
  if (summary.synced > 0) {
    parts.push(
      summary.staged > 0
        ? `${plural(summary.staged, "new transaction", "new transactions")} to review.`
        : "No new transactions.",
    );
  }
  if (summary.busy > 0) {
    parts.push(`${plural(summary.busy, "bank was", "banks were")} already syncing.`);
  }
  if (summary.needsReauth > 0) {
    parts.push(`${plural(summary.needsReauth, "bank needs", "banks need")} you to sign in again in Settings.`);
  }
  if (summary.failed > 0) {
    parts.push(`${plural(summary.failed, "bank", "banks")} could not be reached. Try again later.`);
  }

  const tone = summary.needsReauth > 0 || summary.failed > 0 ? "warning" : summary.staged > 0 ? "success" : "neutral";
  return { ok: true, tone, message: parts.join(" ") };
}
