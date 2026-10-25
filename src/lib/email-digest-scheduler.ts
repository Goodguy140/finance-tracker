import { runBillReminderSweep } from "@/lib/bill-reminders";
import { runChargeAlertSweep } from "@/lib/charge-alerts";
import { runEmailDigestSweep } from "@/lib/email-digest";
import { runWebhookSweep } from "@/lib/webhooks";
import { markSchedulerStarted, recordSchedulerRun } from "@/lib/scheduler-status";

/**
 * In-process scheduler for the emailed digest, bill reminders and charge alerts, started once from
 * `instrumentation.ts` like the other sweeps. Hourly, so each user's email goes out within the
 * hour after 7am in their own time zone; the digest's period key keeps it to one per week or
 * month, and each recurring rule's `reminderSentForDate` keeps a bill to one reminder. Charge alerts go
 * out on any tick, not only after 7am: they are about something that just happened.
 */

const INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 90 * 1000;

const globalState = globalThis as unknown as { __emailDigestScheduler?: boolean };

export function emailDigestSchedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.EMAIL_DIGEST_SCHEDULER?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

export function startEmailDigestScheduler(): boolean {
  if (globalState.__emailDigestScheduler) return false;
  if (!emailDigestSchedulerEnabled()) return false;
  globalState.__emailDigestScheduler = true;

  const sweep = async () => {
    const nextRunAt = new Date(Date.now() + INTERVAL_MS);
    try {
      const digests = await runEmailDigestSweep();
      if (digests.sent > 0) console.log(`[digest] sent ${digests.sent} digest(s)`);
      const reminders = await runBillReminderSweep();
      if (reminders.sent > 0) console.log(`[bill reminders] sent ${reminders.sent} reminder(s)`);
      const charges = await runChargeAlertSweep();
      if (charges.sent > 0) console.log(`[charge alerts] sent ${charges.sent} alert(s)`);
      // Webhook retries and bill.due events ride the same hourly tick.
      const webhooks = await runWebhookSweep();
      const message = [...new Set([digests.message, reminders.message, charges.message, webhooks.message])].join("; ");
      recordSchedulerRun("emailDigest", { ok: digests.ok && reminders.ok && charges.ok && webhooks.ok, message, nextRunAt });
    } catch (err) {
      console.error("[digest] sweep failed", err);
      recordSchedulerRun("emailDigest", {
        ok: false,
        message: err instanceof Error ? err.message : "Sweep failed",
        nextRunAt,
      });
    }
  };
  // `unref` so a pending timer never keeps a shutting-down process alive.
  markSchedulerStarted("emailDigest", new Date(Date.now() + INITIAL_DELAY_MS));
  setTimeout(() => void sweep(), INITIAL_DELAY_MS).unref();
  setInterval(() => void sweep(), INTERVAL_MS).unref();
  return true;
}
