import { AdminBackupPanel } from "@/components/admin-backup-panel";
import { AdminOperationsForm } from "@/components/admin/admin-ops-forms";
import { AdminPageHeader, AdminSection, StatusDot, formatRelative } from "@/components/admin/ui";
import type { DotStatus } from "@/components/admin/ui";
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  getOpsSettingsStatus,
} from "@/lib/ops-settings";
import { plaidSyncSchedulerEnabled } from "@/lib/plaid-sync-scheduler";
import { recurringAutoPostSchedulerEnabled } from "@/lib/recurring-auto-post-scheduler";
import { getSchedulerHeartbeat, type SchedulerHeartbeat } from "@/lib/scheduler-status";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

function heartbeatDot(beat: SchedulerHeartbeat | null, envEnabled: boolean): DotStatus {
  if (!envEnabled || !beat) return "idle";
  if (beat.lastOk === false) return "bad";
  return "ok";
}

function SchedulerRow({
  name,
  description,
  beat,
  envEnabled,
  envName,
}: {
  name: string;
  description: string;
  beat: SchedulerHeartbeat | null;
  envEnabled: boolean;
  envName: string;
}) {
  return (
    <li className="flex gap-3">
      <StatusDot status={heartbeatDot(beat, envEnabled)} />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-100">{name}</p>
        <p className="text-xs text-slate-500">{description}</p>
        {!envEnabled ? (
          <p className="mt-1 text-xs text-slate-400">Not started: {envName} is false in the environment.</p>
        ) : !beat ? (
          <p className="mt-1 text-xs text-slate-400">Not started in this process yet.</p>
        ) : (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Last run</dt>
            <dd className="text-slate-300">
              {beat.lastRunAt ? formatRelative(beat.lastRunAt) : "not yet since boot"}
            </dd>
            <dt className="text-slate-500">Result</dt>
            <dd className={beat.lastOk === false ? "text-red-300" : "text-slate-300"}>{beat.lastResult ?? "—"}</dd>
            <dt className="text-slate-500">Next run</dt>
            <dd className="text-slate-300">{beat.nextRunAt ? formatRelative(beat.nextRunAt) : "—"}</dd>
          </dl>
        )}
      </div>
    </li>
  );
}

export default async function AdminOperationsPage() {
  await requireAdmin();
  const ops = await getOpsSettingsStatus();

  return (
    <>
      <AdminPageHeader
        title="Operations"
        description="Background jobs, housekeeping and backups. Changes apply without a restart."
      />

      <AdminSection
        title="Background jobs"
        description="What each in-process scheduler last did. Held in memory, so it resets when the server restarts."
      >
        <ul className="space-y-4">
          <SchedulerRow
            name="Recurring auto-post"
            description="Hourly. Posts due occurrences of recurring rules set to post automatically."
            beat={getSchedulerHeartbeat("recurringAutoPost")}
            envEnabled={recurringAutoPostSchedulerEnabled()}
            envName="RECURRING_AUTO_POST_SCHEDULER"
          />
          <SchedulerRow
            name="Plaid bank sync"
            description={`Every ${ops.plaidSyncIntervalMinutes.value} minutes. Pulls new bank transactions into each owner's review queue.`}
            beat={getSchedulerHeartbeat("plaidSync")}
            envEnabled={plaidSyncSchedulerEnabled()}
            envName="PLAID_SYNC_SCHEDULER"
          />
        </ul>
      </AdminSection>

      <AdminOperationsForm
        retention={ops.auditRetentionDays}
        recurring={ops.recurringAutoPost}
        minDays={AUDIT_RETENTION_MIN_DAYS}
        maxDays={AUDIT_RETENTION_MAX_DAYS}
      />

      <AdminBackupPanel />
    </>
  );
}
