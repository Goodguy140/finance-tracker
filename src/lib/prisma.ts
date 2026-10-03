import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NODE_ENV === "production" ? "file:/data/app.db" : "file:./dev.db";
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * For interactive transactions that write many rows (an initial bank backfill, a restore, a
 * bulk add). Prisma's defaults (2s wait, 5s run) are sized for a handful of writes.
 */
export const LONG_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 180_000 } as const;
