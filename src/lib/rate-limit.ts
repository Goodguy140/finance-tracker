import { prisma } from "@/lib/prisma";

/** Delete expired rows roughly once in this many limiter calls. */
const SWEEP_ODDS = 50;

/** Thrown when a limiter's window is full; any other error from the limiter is a real failure. */
export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

/**
 * Counts one request against `key` and throws `RateLimitExceededError` (with `message`) once more
 * than `maxRequests` arrive within `windowMs` of the window's first request.
 *
 * Each step is one statement, never an interactive transaction. A transaction that reads the
 * counter and then writes it holds SQLite's read lock while asking for the write lock, so
 * simultaneous requests (the phone app refreshes several screens at once after every change)
 * waited on each other until Prisma's 5-second limit and failed. The upsert counts atomically
 * instead: a burst on a new key is numbered 1, 2, 3… with none lost.
 */
export async function enforceSlidingWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  message: string,
) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const counted = await countRequest(key, resetAt);
  let count = counted.count;

  if (counted.resetAt <= now) {
    // The window had closed: start a new one with this request. The `resetAt` condition lets
    // exactly one of several simultaneous requests do it; the rest are counted in the new window.
    const started = await prisma.rateLimitEntry.updateMany({
      where: { key, resetAt: { lte: now } },
      data: { count: 1, resetAt },
    });
    count = started.count === 1 ? 1 : (await countRequest(key, resetAt)).count;
  }

  if (count > maxRequests) {
    throw new RateLimitExceededError(message);
  }

  await maybeSweepExpiredEntries();
}

/** Adds one to the counter (creating it at 1), in one statement, and returns it. */
function countRequest(key: string, resetAt: Date) {
  return prisma.rateLimitEntry.upsert({
    where: { key },
    create: { key, count: 1, resetAt },
    update: { count: { increment: 1 } },
    select: { count: true, resetAt: true },
  });
}

/**
 * Clears a limiter counter after the attempt it was guarding succeeded.
 *
 * Without this, the login limiter counts successful sign-ins toward its own budget, so
 * ten honest logins inside the window lock the account owner out — and anyone who knows
 * the address can burn the budget on their behalf.
 */
export async function clearRateLimit(key: string) {
  await prisma.rateLimitEntry.deleteMany({ where: { key } });
}

/**
 * `RateLimitEntry` keys are attacker-influenced (one row per address ever tried), so the
 * table grows without bound if nothing removes expired windows. Sweeping probabilistically
 * keeps it bounded without adding a scheduler or a query to every request.
 */
async function maybeSweepExpiredEntries() {
  if (Math.floor(Math.random() * SWEEP_ODDS) !== 0) return;
  try {
    await prisma.rateLimitEntry.deleteMany({ where: { resetAt: { lte: new Date() } } });
  } catch {
    // Housekeeping must never fail the request it piggybacked on.
  }
}
