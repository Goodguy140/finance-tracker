import fs from "node:fs";
import path from "node:path";
import { summarizeDatabaseUrlDisplay } from "@/lib/admin-system-health";

export type AdminRuntimeMetrics = {
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  databaseFile: {
    applicable: boolean;
    pathLabel: string | null;
    sizeMb: number | null;
    diskFreeGb: number | null;
    diskTotalGb: number | null;
  };
};

function bytesToMb(n: number): number {
  return Math.round((n / (1024 * 1024)) * 10) / 10;
}

function bytesToGb(n: number): number {
  return Math.round((n / (1024 * 1024 * 1024)) * 10) / 10;
}

function resolveSqliteFilePath(databaseUrl: string): string | null {
  const summary = summarizeDatabaseUrlDisplay(databaseUrl);
  if (summary.kind !== "sqlite_file") return null;
  const raw = databaseUrl.trim();
  const withoutScheme = raw.slice("file:".length).split("?")[0] ?? "";
  if (!withoutScheme) return null;
  return path.isAbsolute(withoutScheme) ? withoutScheme : path.resolve(/* turbopackIgnore: true */ process.cwd(), withoutScheme);
}

export function getAdminRuntimeMetrics(): AdminRuntimeMetrics {
  const mem = process.memoryUsage();
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const filePath = resolveSqliteFilePath(databaseUrl);

  let sizeMb: number | null = null;
  let diskFreeGb: number | null = null;
  let diskTotalGb: number | null = null;
  let pathLabel: string | null = null;

  if (filePath) {
    pathLabel = path.basename(filePath);
    try {
      const stat = fs.statSync(/* turbopackIgnore: true */ filePath);
      sizeMb = bytesToMb(stat.size);
    } catch {
      sizeMb = null;
    }
    try {
      const parent = path.dirname(filePath);
      const statfs = fs.statfsSync(parent);
      const freeBytes = Number(statfs.bfree) * Number(statfs.bsize);
      diskFreeGb = bytesToGb(freeBytes);
      diskTotalGb = bytesToGb(Number(statfs.blocks) * Number(statfs.bsize));
    } catch {
      diskFreeGb = null;
      diskTotalGb = null;
    }
  }

  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: bytesToMb(mem.rss),
      heapUsedMb: bytesToMb(mem.heapUsed),
      heapTotalMb: bytesToMb(mem.heapTotal),
    },
    databaseFile: {
      applicable: filePath != null,
      pathLabel,
      sizeMb,
      diskFreeGb,
      diskTotalGb,
    },
  };
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
