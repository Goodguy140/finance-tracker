import { prisma } from "@/lib/prisma";

/** Delete expired rows roughly once in this many limiter calls. */
const SWEEP_ODDS = 50;

export async function enforceSlidingWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  message: string,
) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitEntry.findUnique({ where: { key } });

    if (!existing || existing.resetAt <= now) {
      await tx.rateLimitEntry.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt },
      });
      return;
    }

    if (existing.count >= maxRequests) {
      throw new Error(message);
    }

    await tx.rateLimitEntry.update({
      where: { key },
      data: { count: existing.count + 1 },
    });
  });

  await maybeSweepExpiredEntries();
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
