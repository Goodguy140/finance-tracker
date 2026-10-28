import { createDatabaseBackup, getBackupDirectory, isBackupDue, listBackupFiles } from "@/lib/database-backups";
import { getOpsSettingsStatus } from "@/lib/ops-settings";
import { prisma } from "@/lib/prisma";
import { markSchedulerStarted, recordSchedulerRun } from "@/lib/scheduler-status";

/**
 * Hourly check, started from `instrumentation.ts` like the other sweeps, that makes the day's
 * database copy once the backup hour has come. The settings are re-read every tick, so
 * switching backups off or moving the hour on Operations needs no restart.
 */

const INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

const globalState = globalThis as unknown as { __databaseBackupScheduler?: boolean };

export function databaseBackupSchedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.DATABASE_BACKUPS?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

export async function runDatabaseBackupTick(now = new Date()): Promise<{ ok: boolean; message: string }> {
  const ops = await getOpsSettingsStatus();
  if (!ops.backupEnabled.value) return { ok: true, message: "Automatic backups are off." };
  const dir = await getBackupDirectory(prisma);
  if (!dir) return { ok: false, message: "The database is not a SQLite file, so there is nothing to copy." };
  const newestAt = listBackupFiles(dir)[0]?.createdAt ?? null;
  if (!isBackupDue({ newestAt, now, hour: ops.backupHour.value })) {
    return { ok: true, message: newestAt ? "Today's backup is done or not due yet." : "First backup not due yet." };
  }
  const { file, pruned } = await createDatabaseBackup(prisma, { keepDays: ops.backupKeepDays.value, now });
  const removed = pruned.length > 0 ? `, removed ${pruned.length} old` : "";
  return { ok: true, message: `Saved ${file.name}${removed}.` };
}

export function startDatabaseBackupScheduler(): boolean {
  if (globalState.__databaseBackupScheduler) return false;
  if (!databaseBackupSchedulerEnabled()) return false;
  globalState.__databaseBackupScheduler = true;

  const tick = async () => {
    const nextRunAt = new Date(Date.now() + INTERVAL_MS);
    try {
      const result = await runDatabaseBackupTick();
      if (result.message.startsWith("Saved")) console.log(`[backup] ${result.message}`);
      recordSchedulerRun("databaseBackup", { ...result, nextRunAt });
    } catch (err) {
      console.error("[backup] failed", err);
      recordSchedulerRun("databaseBackup", {
        ok: false,
        message: err instanceof Error ? err.message : "Backup failed",
        nextRunAt,
      });
    }
  };
  // `unref` so a pending timer never keeps a shutting-down process alive.
  markSchedulerStarted("databaseBackup", new Date(Date.now() + INITIAL_DELAY_MS));
  setTimeout(() => void tick(), INITIAL_DELAY_MS).unref();
  setInterval(() => void tick(), INTERVAL_MS).unref();
  return true;
}
