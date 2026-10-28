import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import {
  backupFileName,
  createDatabaseBackup,
  getBackupDirectory,
  isBackupDue,
  listBackupFiles,
  parseBackupFileName,
  selectBackupsToPrune,
} from "./database-backups";

const DAY = 24 * 60 * 60 * 1000;

describe("backup file names", () => {
  it("round-trip the moment the copy was made, to the second", () => {
    const at = new Date("2026-10-28T03:05:12.789Z");
    expect(backupFileName(at)).toBe("app-2026-10-28T030512Z.db");
    expect(parseBackupFileName(backupFileName(at))?.toISOString()).toBe("2026-10-28T03:05:12.000Z");
  });

  it("ignore anything else in the folder", () => {
    expect(parseBackupFileName("app-2026-10-28T030512Z.db.partial")).toBeNull();
    expect(parseBackupFileName("app.db")).toBeNull();
  });
});

describe("selectBackupsToPrune", () => {
  const now = new Date("2026-10-28T03:00:00Z");
  const daily = (daysAgo: number) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY);
    return { name: backupFileName(createdAt), createdAt };
  };

  it("keeps the last keepDays and the newest of each recent month, and prunes the rest", () => {
    const files = Array.from({ length: 120 }, (_, i) => daily(i));
    const pruned = new Set(selectBackupsToPrune(files, 14, now));
    const kept = files.filter((f) => !pruned.has(f.name)).map((f) => f.createdAt.toISOString().slice(0, 10));
    // 15 days back to Oct 14 inclusive, then the newest copy of Sep, Aug, Jul: the month's last day.
    expect(kept.slice(0, 15)).toEqual(files.slice(0, 15).map((f) => f.createdAt.toISOString().slice(0, 10)));
    expect(kept.slice(15)).toEqual(["2026-09-30", "2026-08-31", "2026-07-31"]);
  });

  it("never removes the newest copy, however old", () => {
    const files = [daily(400), daily(401)];
    expect(selectBackupsToPrune(files, 14, now)).toEqual([daily(401).name]);
  });
});

describe("isBackupDue", () => {
  const at = (iso: string) => new Date(iso);
  it("waits for the hour, then makes one copy that day", () => {
    const base = { hour: 3, timeZone: "America/Toronto" };
    // 02:30 in Toronto: too early.
    expect(isBackupDue({ ...base, newestAt: null, now: at("2026-10-28T06:30:00Z") })).toBe(false);
    // 03:10 in Toronto with yesterday's copy: due.
    expect(isBackupDue({ ...base, newestAt: at("2026-10-27T07:05:00Z"), now: at("2026-10-28T07:10:00Z") })).toBe(true);
    // A copy made earlier today, even before the hour by "Back up now", counts.
    expect(isBackupDue({ ...base, newestAt: at("2026-10-28T05:00:00Z"), now: at("2026-10-28T08:00:00Z") })).toBe(false);
  });
});

describe("createDatabaseBackup", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-backup-"));
  const url = `file:${join(dir, "app.db")}`;
  let db: PrismaClient;

  beforeAll(() => {
    copyMigratedDatabase(url);
    db = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a complete, openable copy beside the database and prunes old ones", async () => {
    await db.user.create({ data: { email: "backup@example.test", displayName: "B" } });
    const backupDir = await getBackupDirectory(db, {});
    expect(backupDir).toBe(join(dir, "backups"));

    const now = new Date("2026-10-28T03:00:00Z");
    const old = new Date(now.getTime() - 40 * DAY);
    const recent = new Date(now.getTime() - 5 * DAY);
    mkdirSync(backupDir!, { recursive: true });
    writeFileSync(join(backupDir!, backupFileName(old)), "stale");
    writeFileSync(join(backupDir!, backupFileName(new Date(old.getTime() + DAY))), "stale");
    writeFileSync(join(backupDir!, backupFileName(recent)), "recent");

    const { file, pruned } = await createDatabaseBackup(db, { keepDays: 14, now });
    expect(file.name).toBe(backupFileName(now));
    // Of the two September copies the newer one stays as that month's copy.
    expect(pruned).toEqual([backupFileName(old)]);
    expect(readdirSync(backupDir!).sort()).toEqual(
      [backupFileName(now), backupFileName(recent), backupFileName(new Date(old.getTime() + DAY))].sort(),
    );

    const copy = new PrismaClient({ datasourceUrl: `file:${join(backupDir!, file.name)}` });
    try {
      expect(await copy.user.count({ where: { email: "backup@example.test" } })).toBe(1);
    } finally {
      await copy.$disconnect();
    }
    expect(listBackupFiles(backupDir!)[0]?.name).toBe(file.name);
  });
});
