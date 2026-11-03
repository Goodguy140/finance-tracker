import { TransactionType, type Prisma } from "@prisma/client";
import { ymdFromDateUtc } from "@/lib/date-only";
import {
  advanceRecurringDate,
  isRecurringOccurrenceOnOrAfterNext,
  recurringAnchor,
  recurringAnchorDay,
} from "@/lib/recurring-transactions";
import { RecurringOccurrenceError } from "@/lib/recurring-post";

/** Days on either side of the expected date to search for a matching already-logged expense. */
const ALREADY_LOGGED_MATCH_WINDOW_DAYS = 15;

export type SkipReason = "skip_once" | "already_logged";

/**
 * Skipping a recurring occurrence: the one code path behind the website's Skip dialog and the
 * phone's Skip. Moves the rule past `expectedDate` without posting it. `already_logged` first
 * links the entry the person logged themselves (`transactionId`, or else an unlinked entry with
 * the rule's name within 15 days of the date, closest first; none found still skips). Throws with
 * a user-facing message when the occurrence is no longer the rule's outstanding one (or a later one
 * on its cadence) or the rule is off.
 */
export async function skipRecurringOccurrence(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    recurringTransactionId: string;
    expectedDate: Date;
    reason: SkipReason;
    transactionId?: string;
  },
): Promise<void> {
  const { userId, expectedDate } = params;
  const rule = await tx.recurringTransaction.findFirst({
    where: { id: params.recurringTransactionId, userId },
    select: {
      id: true,
      name: true,
      type: true,
      cadence: true,
      enabled: true,
      endDate: true,
      nextExpectedDate: true,
      anchorDay: true,
      secondAnchorDay: true,
      beforeWeekend: true,
    },
  });
  if (!rule) throw new RecurringOccurrenceError("Subscription not found.", true);

  // Optimistic concurrency: only advance if this is still the current occurrence, or a
  // later one on the rule's cadence (which passes over the missed ones before it).
  const anchorDay = recurringAnchorDay(rule);
  const anchor = recurringAnchor(rule);
  if (!isRecurringOccurrenceOnOrAfterNext(rule.nextExpectedDate, rule.cadence, expectedDate, anchor)) {
    throw new RecurringOccurrenceError("This subscription has already moved to a different expected date.");
  }
  if (!rule.enabled) throw new RecurringOccurrenceError("Subscription is disabled.");

  if (params.reason === "already_logged") {
    await linkAlreadyLoggedTransaction(tx, { userId, rule, expectedDate, transactionId: params.transactionId });
  }

  const nextExpectedDate = advanceRecurringDate(expectedDate, rule.cadence, anchor);
  const stillEnabled = !rule.endDate || ymdFromDateUtc(nextExpectedDate) <= ymdFromDateUtc(rule.endDate);
  await tx.recurringTransaction.updateMany({
    where: { id: rule.id, userId, enabled: true, nextExpectedDate: rule.nextExpectedDate },
    data: { nextExpectedDate, anchorDay, enabled: stillEnabled },
  });
}

async function linkAlreadyLoggedTransaction(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    rule: { id: string; name: string; type: TransactionType };
    expectedDate: Date;
    transactionId?: string;
  },
) {
  // Match the rule's own kind: an income rule links an income entry, not an expense.
  const type = params.rule.type;
  const kindLabel =
    type === TransactionType.INCOME ? "income entry" : type === TransactionType.TRANSFER ? "transfer" : "expense";
  if (params.transactionId) {
    const txn = await tx.transaction.findFirst({
      where: {
        id: params.transactionId,
        userId: params.userId,
        type,
        recurringTransactionId: null,
      },
      select: { id: true },
    });
    if (!txn) throw new RecurringOccurrenceError(`Selected ${kindLabel} was not found or is already linked to a recurring transaction.`);
    await tx.transaction.update({
      where: { id: txn.id },
      data: { recurringTransactionId: params.rule.id, recurringExpectedDate: params.expectedDate },
    });
    return;
  }

  // Auto-match an unlinked entry with the same title near the expected date (closest wins).
  const windowMs = ALREADY_LOGGED_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const candidates = await tx.transaction.findMany({
    where: {
      userId: params.userId,
      type,
      recurringTransactionId: null,
      title: params.rule.name,
      date: {
        gte: new Date(params.expectedDate.getTime() - windowMs),
        lte: new Date(params.expectedDate.getTime() + windowMs),
      },
    },
    select: { id: true, date: true },
  });
  if (candidates.length === 0) return; // Nothing to link; still advance the schedule.

  const best = candidates.reduce((closest, candidate) => {
    const closestDiff = Math.abs(closest.date.getTime() - params.expectedDate.getTime());
    const candidateDiff = Math.abs(candidate.date.getTime() - params.expectedDate.getTime());
    return candidateDiff < closestDiff ? candidate : closest;
  });
  await tx.transaction.update({
    where: { id: best.id },
    data: { recurringTransactionId: params.rule.id, recurringExpectedDate: params.expectedDate },
  });
}
