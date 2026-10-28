import { AdminBackupPanel } from "@/components/admin-backup-panel";
import {
  AdminBackupNowButton,
  AdminBackupSettingsForm,
  AdminOperationsForm,
} from "@/components/admin/admin-ops-forms";
import { AdminPageHeader, AdminSection, StatusDot, formatRelative } from "@/components/admin/ui";
import type { DotStatus } from "@/components/admin/ui";
import { databaseBackupSchedulerEnabled } from "@/lib/database-backup-scheduler";
import { getBackupDirectory, listBackupFiles } from "@/lib/database-backups";
import { prisma } from "@/lib/prisma";
import {
  AUDIT_RETENTION_MAX_DAYS,
  BACKUP_KEEP_MAX_DAYS,
  BACKUP_KEEP_MIN_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  getOpsSettingsStatus,
} from "@/lib/ops-settings";
import { emailDigestSchedulerEnabled } from "@/lib/email-digest-scheduler";
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminOperationsPage() {
  await requireAdmin();
  const ops = await getOpsSettingsStatus();
  const backupDir = await getBackupDirectory(prisma);
  const backups = backupDir ? listBackupFiles(backupDir) : [];

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
          <SchedulerRow
            name="Email digest, bill reminders and charge alerts"
            description="Hourly. Sends each weekly or monthly spending digest that is due, and reminders of bills coming up, after 7am in the user's time zone."
            beat={getSchedulerHeartbeat("emailDigest")}
            envEnabled={emailDigestSchedulerEnabled()}
            envName="EMAIL_DIGEST_SCHEDULER"
          />
          <SchedulerRow
            name="Database backup"
            description={`Hourly check. Copies the database once a day from ${ops.backupHour.value}:00 server time.`}
            beat={getSchedulerHeartbeat("databaseBackup")}
            envEnabled={databaseBackupSchedulerEnabled()}
            envName="DATABASE_BACKUPS"
          />
        </ul>
      </AdminSection>

      <AdminOperationsForm
        retention={ops.auditRetentionDays}
        recurring={ops.recurringAutoPost}
        minDays={AUDIT_RETENTION_MIN_DAYS}
        maxDays={AUDIT_RETENTION_MAX_DAYS}
      />

      <AdminBackupSettingsForm
        enabled={ops.backupEnabled}
        keepDays={ops.backupKeepDays}
        hour={ops.backupHour}
        minDays={BACKUP_KEEP_MIN_DAYS}
        maxDays={BACKUP_KEEP_MAX_DAYS}
      />

      <AdminSection
        title="Saved backups"
        description={
          backupDir
            ? `In ${backupDir} on the server. To restore, stop the app, put a copy in place of the database file, and start it again.`
            : "The database is not a SQLite file, so the app cannot copy it. Back it up with your database's own tools."
        }
      >
        {backupDir ? (
          <div className="space-y-3">
            {backups.length === 0 ? (
              <p className="text-sm text-slate-400">No backups yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm" aria-label="Saved backups">
                {backups.slice(0, 10).map((file) => (
                  <li key={file.name} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span className="font-mono text-xs text-slate-200 break-all">{file.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatRelative(file.createdAt.toISOString())} · {formatSize(file.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {backups.length > 10 ? (
              <p className="text-xs text-slate-500">And {backups.length - 10} older.</p>
            ) : null}
            <AdminBackupNowButton />
          </div>
        ) : null}
      </AdminSection>

      <AdminBackupPanel />
    </>
  );
}
