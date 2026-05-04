import type { BillingCycle } from "@prisma/client";
import { ymdFromDateUtc } from "./date-only";
import { prisma } from "./prisma";

/** Add calendar months in UTC, clamping the day (e.g. Jan 31 + 1 month → Feb 28). */
export function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = m + months;
  const anchor = new Date(Date.UTC(y, targetMonth, 1));
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  const dayClamped = Math.min(day, lastDay);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), dayClamped));
}

export function advanceOneBillingCycle(d: Date, cycle: BillingCycle): Date {
  const x = new Date(d.getTime());
  switch (cycle) {
    case "WEEKLY":
      x.setUTCDate(x.getUTCDate() + 7);
      return x;
    case "MONTHLY":
      return addUtcMonths(d, 1);
    case "QUARTERLY":
      return addUtcMonths(d, 3);
    case "YEARLY":
      return addUtcMonths(d, 12);
    case "BIENNIAL":
      return addUtcMonths(d, 24);
    default:
      return addUtcMonths(d, 1);
  }
}

/**
 * If `nextChargeDate` is before today's UTC calendar day, advances by the billing cycle until it is
 * on or after today (so overdue subscriptions catch up to the next upcoming charge day).
 */
export function computeRolledForwardNextChargeDate(
  nextChargeDate: Date,
  billingCycle: BillingCycle,
  now: Date = new Date(),
): Date {
  let d = new Date(nextChargeDate.getTime());
  const todayYmd = ymdFromDateUtc(now);
  let guard = 0;
  while (ymdFromDateUtc(d) < todayYmd && guard < 520) {
    d = advanceOneBillingCycle(d, billingCycle);
    guard++;
  }
  return d;
}

/**
 * Persists rolled-forward next charge dates for any subscription whose stored date is still in the past (UTC day).
 */
export async function syncSubscriptionNextChargeDatesForUser(userId: string): Promise<void> {
  const now = new Date();
  const subs = await prisma.subscription.findMany({ where: { userId } });
  const updates = subs
    .map((sub) => {
      const next = computeRolledForwardNextChargeDate(sub.nextChargeDate, sub.billingCycle, now);
      if (next.getTime() === sub.nextChargeDate.getTime()) return null;
      return prisma.subscription.update({
        where: { id: sub.id },
        data: { nextChargeDate: next },
      });
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (updates.length === 0) return;
  await prisma.$transaction(updates);
}
