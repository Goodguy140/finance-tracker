import { insightSizeCents } from "@/lib/insights/index";
import { loadInsights } from "@/lib/insights/load";
import { prisma } from "@/lib/prisma";

/** How long "Snooze" hides an insight. */
export const INSIGHT_SNOOZE_DAYS = 30;

export type InsightDismissMode = "snooze" | "forever";

/**
 * Hides an insight: for `INSIGHT_SNOOZE_DAYS`, or for good. Behind the website's Snooze and
 * Dismiss buttons and the phone app's. Its size now is worked out again on the server rather
 * than taken from the caller, so it can come back if it grows well past what was dismissed.
 */
export async function dismissInsight(
  user: { id: string; countryCode: string; timezone: string | null },
  insightKey: string,
  mode: InsightDismissMode,
  now: Date = new Date(),
): Promise<void> {
  const snoozedUntil = mode === "snooze" ? new Date(now.getTime() + INSIGHT_SNOOZE_DAYS * 24 * 60 * 60 * 1000) : null;
  const insights = await loadInsights(user.id, user.countryCode, user.timezone);
  const insight = [...insights.visible, ...insights.dismissed].find((i) => i.key === insightKey);
  const dismissedCents = insight ? insightSizeCents(insight) : null;
  await prisma.insightDismissal.upsert({
    where: { userId_insightKey: { userId: user.id, insightKey } },
    create: { userId: user.id, insightKey, snoozedUntil, dismissedCents },
    update: { snoozedUntil, dismissedCents },
  });
}

/** Lists a dismissed or snoozed insight again. */
export async function restoreInsight(userId: string, insightKey: string): Promise<void> {
  await prisma.insightDismissal.deleteMany({ where: { userId, insightKey } });
}
