import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/**
 * Automatic copies of the whole SQLite database, kept beside it in a `backups` folder.
 *
 * The JSON export covers one user and only when someone presses the button; the server's one
 * database file had no copy at all unless the operator backed up the volume. A copy is made
 * with `VACUUM INTO`, which SQLite runs as a consistent read while the app keeps writing, so
 * nothing has to stop. It is written under a `.partial` name and renamed once complete, so a
 * crash mid-copy never leaves a file that looks like a good backup.
 *
 * The folder holds every user's data, password hashes included, exactly as the database does:
 * it is no more exposed than the file beside it, and is never served by the app.
 */

export const BACKUP_FILE_PATTERN = /^app-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;
/** Besides the last `keepDays`, the newest copy of each of this many calendar months stays. */
export const MONTHLY_BACKUPS_KEPT = 6;

export type BackupFile = { name: string; createdAt: Date; sizeBytes: number };

export function backupFileName(at: Date): string {
  const iso = at.toISOString(); // 2026-10-28T03:05:12.345Z
  return `app-${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z.db`;
}

/** When the copy was made, from its name; null for anything that is not one of ours. */
export function parseBackupFileName(name: string): Date | null {
  const m = BACKUP_FILE_PATTERN.exec(name);
  if (!m) return null;
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Which copies to delete: everything older than `keepDays` except the newest copy of each of
 * the last few calendar months, and never the newest copy of all, however old, so a server
 * whose backups stopped still has its last one.
 */
export function selectBackupsToPrune(
  files: readonly { name: string; createdAt: Date }[],
  keepDays: number,
  now: Date,
): string[] {
  const sorted = [...files].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const monthsSeen = new Set<string>();
  const prune: string[] = [];
  sorted.forEach((file, index) => {
    const month = file.createdAt.toISOString().slice(0, 7);
    const newestOfMonth = !monthsSeen.has(month);
    monthsSeen.add(month);
    if (index === 0) return;
    if (file.createdAt.getTime() >= cutoff) return;
    if (newestOfMonth && monthsSeen.size <= MONTHLY_BACKUPS_KEPT) return;
    prune.push(file.name);
  });
  return prune;
}

function localParts(at: Date, timeZone?: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number.parseInt(get("hour"), 10) };
}

/**
 * Once a day, on the first tick at or after `hour` in the server's time zone (`TZ`). A day
 * that already has a copy, made by the sweep or by "Back up now", gets no second one.
 */
export function isBackupDue(input: {
  newestAt: Date | null;
  now: Date;
  hour: number;
  timeZone?: string;
}): boolean {
  const today = localParts(input.now, input.timeZone);
  if (today.hour < input.hour) return false;
  if (!input.newestAt) return true;
  return localParts(input.newestAt, input.timeZone).day !== today.day;
}

/** The main database's file, as SQLite itself reports it; null when it is not a file. */
export async function getDatabaseFilePath(prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const file = rows.find((row) => row.name === "main")?.file;
  return file ? file : null;
}

/** `BACKUP_DIR` when set, otherwise a `backups` folder beside the database. */
export async function getBackupDirectory(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const fromEnv = env.BACKUP_DIR?.trim();
  if (fromEnv) return path.resolve(/* turbopackIgnore: true */ fromEnv);
  const dbFile = await getDatabaseFilePath(prisma);
  return dbFile ? path.join(path.dirname(dbFile), "backups") : null;
}

export function listBackupFiles(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(/* turbopackIgnore: true */ dir);
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    const createdAt = parseBackupFileName(name);
    if (!createdAt) continue;
    try {
      files.push({ name, createdAt, sizeBytes: fs.statSync(path.join(dir, name)).size });
    } catch {
      // Removed between the listing and the stat: not there, so not listed.
    }
  }
  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type BackupResult = { file: BackupFile; pruned: string[] };

/** Makes one copy now and prunes the folder. Throws with a readable message on failure. */
export async function createDatabaseBackup(
  prisma: PrismaClient,
  options: { keepDays: number; now?: Date; dir?: string },
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const dir = options.dir ?? (await getBackupDirectory(prisma));
  if (!dir) throw new Error("The database is not a SQLite file, so there is nothing to copy.");
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });

  const name = backupFileName(now);
  const target = path.join(dir, name);
  const partial = `${target}.partial`;
  // VACUUM INTO refuses an existing file; a leftover from a crashed copy is worthless.
  fs.rmSync(/* turbopackIgnore: true */ partial, { force: true });
  try {
    await prisma.$executeRawUnsafe("VACUUM INTO ?", partial);
    fs.renameSync(/* turbopackIgnore: true */ partial, target);
  } catch (err) {
    fs.rmSync(/* turbopackIgnore: true */ partial, { force: true });
    throw new Error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const pruned = selectBackupsToPrune(listBackupFiles(dir), options.keepDays, now);
  for (const old of pruned) fs.rmSync(/* turbopackIgnore: true */ path.join(dir, old), { force: true });

  const file = listBackupFiles(dir).find((f) => f.name === name);
  if (!file) throw new Error("Backup failed: the copy is missing after it was written.");
  return { file, pruned };
}
