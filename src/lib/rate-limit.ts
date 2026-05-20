import { prisma } from "@/lib/prisma";

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
}
