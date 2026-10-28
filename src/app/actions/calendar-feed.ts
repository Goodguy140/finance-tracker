"use server";

import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { calendarFeedPath, generateCalendarFeedToken } from "@/lib/calendar-feed";
import { prisma } from "@/lib/prisma";
import { requireRecentIdentity } from "@/lib/recent-identity";
import { requireUser } from "@/lib/session";
import { formAction, formActionWithResult } from "./_helpers";

/**
 * Makes the user's private calendar link, replacing any earlier one (which stops working).
 * The link is a standing read credential for an outside service, so making it needs a
 * recent "confirm it's you", like the other actions a stolen session cookie must not take.
 * Returns the link's path once; only its hash is kept.
 */
export const createCalendarFeedAction = formActionWithResult(async (): Promise<{ ok: true; path: string }> => {
  const { user } = await requireRecentIdentity();
  const { raw, hash } = generateCalendarFeedToken();
  await prisma.calendarFeed.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tokenHash: hash },
    update: { tokenHash: hash, createdAt: new Date(), lastFetchedAt: null },
  });
  await recordAuditLog(prisma, { userId: user.id, action: AUDIT_ACTIONS.calendar_feed_created, targetType: "calendar_feed", targetId: user.id });
  revalidatePath("/settings/notifications");
  return { ok: true, path: calendarFeedPath(raw) };
});

/** Turns the calendar link off: calendars subscribed to it get nothing more. */
export const deleteCalendarFeedAction = formAction(async () => {
  const user = await requireUser();
  const { count } = await prisma.calendarFeed.deleteMany({ where: { userId: user.id } });
  if (count > 0) {
    await recordAuditLog(prisma, { userId: user.id, action: AUDIT_ACTIONS.calendar_feed_removed, targetType: "calendar_feed", targetId: user.id });
  }
  revalidatePath("/settings/notifications");
});
