import type { Prisma } from "@prisma/client";
import { RecurringPostMode } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import {
  advanceRecurringDate,
  isRecurringOccurrenceOnOrAfterNext,
  recurringAnchorDay,
} from "@/lib/recurring-transactions";
import { recomputeSubscriptionTransactionCredits } from "@/lib/subscription-credit";

/**
 * Posting a recurring occurrence: the one code path behind the dashboard's "Post
 * transaction" button and the automatic poster for rules in `AUTO` mode.
 */

export type PostOutcome = "posted" | "already_posted" | "no_change";

/** The two enums share their values: each transaction type has categories of its own kind. */
function categoryKindFor(type: "EXPENSE" | "INCOME" | "TRANSFER") {
  return type;
}

/**
 * Posts the occurrence of `recurringTransactionId` expected on `expectedDate` inside the
 * given transaction client, and advances the rule to the occurrence after it. That is
 * normally the rule's outstanding occurrence; a later one on its cadence is accepted too,
 * passing over the missed ones before it. Idempotent: if the
 * rule has already moved past that date and a matching transaction exists, nothing
 * happens. Throws with a user-facing message for anything that should stop the caller
 * (disabled rule, archived account, mismatched category, past the end date, or an
 * occurrence that was skipped rather than posted).
 */
export async function postRecurringOccurrence(
  tx: Prisma.TransactionClient,
  params: { userId: string; recurringTransactionId: string; expectedDate: Date; needsReview?: boolean },
): Promise<PostOutcome> {
  const { userId, recurringTransactionId, expectedDate } = params;
  const expectedYmd = ymdFromDateUtc(expectedDate);

  const rule = await tx.recurringTransaction.findFirst({
    where: { id: recurringTransactionId, userId },
    include: { account: true, category: true },
  });
  if (!rule) throw new Error("Recurring transaction not found.");

  // A later occurrence on the rule's cadence may be posted directly; it passes over the
  // ones before it (the dashboard offers this month's occurrence of an overdue rule).
  const anchorDay = recurringAnchorDay(rule);
  if (!isRecurringOccurrenceOnOrAfterNext(rule.nextExpectedDate, rule.cadence, expectedDate, anchorDay)) {
    const posted = await tx.transaction.findFirst({
      where: { userId, recurringTransactionId: rule.id, recurringExpectedDate: expectedDate },
      select: { id: true },
    });
    if (posted) return "already_posted";
    throw new Error("This recurring transaction has already moved to a different expected date.");
  }
  if (!rule.enabled) throw new Error("Recurring transaction is disabled.");
  if (rule.account.archived) throw new Error("Cannot post a recurring transaction to an archived account.");
  if (rule.category.kind !== categoryKindFor(rule.type)) {
    throw new Error("Recurring transaction category does not match its income/expense type.");
  }
  if (rule.endDate && expectedYmd > ymdFromDateUtc(rule.endDate)) {
    throw new Error("Recurring transaction has passed its end date.");
  }

  const nextExpectedDate = advanceRecurringDate(expectedDate, rule.cadence, anchorDay);
  const stillEnabled = !rule.endDate || ymdFromDateUtc(nextExpectedDate) <= ymdFromDateUtc(rule.endDate);
  const updated = await tx.recurringTransaction.updateMany({
    where: { id: rule.id, userId, enabled: true, nextExpectedDate: rule.nextExpectedDate },
    // Stored on a rule saved before anchorDay existed, before its date can be clamped.
    data: { nextExpectedDate, anchorDay, enabled: stillEnabled },
  });
  if (updated.count === 0) return "no_change";

  await tx.transaction.create({
    data: {
      userId,
      accountId: rule.accountId,
      categoryId: rule.categoryId,
      type: rule.type,
      // Transfers carry the expense sign: positive is money leaving `accountId` for this one.
      transferAccountId: rule.type === "TRANSFER" ? rule.transferAccountId : null,
      amountCents: rule.amountCents,
      title: rule.name,
      date: expectedDate,
      note: rule.note,
      recurringTransactionId: rule.id,
      recurringExpectedDate: expectedDate,
      // Posted by the schedule rather than the user's own Post button.
      needsReview: params.needsReview ?? false,
    },
  });

  // Apply credits for any shared-subscription members already marked paid for this occurrence.
  await recomputeSubscriptionTransactionCredits(tx, { userId, recurringTransactionId: rule.id, expectedDate });
  return "posted";
}

/** Safety valve: a rule left alone for years must not post hundreds of rows in one go. */
const MAX_AUTO_POSTS_PER_RULE = 24;

export type AutoPostSummary = { posted: number; ruleIds: string[] };

/**
 * Posts every occurrence that is due (expected on or before today in the user's zone)
 * for the user's enabled rules in `AUTO` mode. Each occurrence is its own transaction so
 * one bad rule (archived account, category kind mismatch) does not block the others; a
 * rule that throws is left for the dashboard to show as overdue.
 *
 * Anything posted is spending like any other, so it schedules the budget alert emails the
 * manual "Post transaction" button does. Both callers (the hourly sweep and the dashboard
 * load) come through here, which is what keeps them from forgetting.
 */
export async function autoPostDueRecurringTransactions(
  userId: string,
  now = new Date(),
  client = prisma,
): Promise<AutoPostSummary> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (!user) return { posted: 0, ruleIds: [] };
  const today = dateFromYmd(currentYmdInTimeZone(user.timezone, now));

  const due = await client.recurringTransaction.findMany({
    where: { userId, enabled: true, postMode: RecurringPostMode.AUTO, nextExpectedDate: { lte: today } },
    select: { id: true, nextExpectedDate: true },
    orderBy: { nextExpectedDate: "asc" },
  });

  let posted = 0;
  const ruleIds: string[] = [];
  for (const rule of due) {
    let expectedDate = rule.nextExpectedDate;
    for (let i = 0; i < MAX_AUTO_POSTS_PER_RULE && expectedDate.getTime() <= today.getTime(); i += 1) {
      let outcome: PostOutcome;
      try {
        outcome = await client.$transaction((tx) =>
          postRecurringOccurrence(tx, { userId, recurringTransactionId: rule.id, expectedDate, needsReview: true }),
        );
      } catch (err) {
        console.warn(`[recurring] auto-post skipped rule ${rule.id}:`, err instanceof Error ? err.message : err);
        break;
      }
      if (outcome !== "posted") break;
      posted += 1;
      if (!ruleIds.includes(rule.id)) ruleIds.push(rule.id);
      const fresh = await client.recurringTransaction.findUnique({
        where: { id: rule.id },
        select: { nextExpectedDate: true, enabled: true },
      });
      if (!fresh?.enabled) break;
      expectedDate = fresh.nextExpectedDate;
    }
  }
  if (posted > 0) scheduleBudgetAlertEmails(userId);
  return { posted, ruleIds };
}

/** Every user with at least one due `AUTO` rule, for the in-process scheduler. */
export async function autoPostDueRecurringTransactionsForAllUsers(now = new Date(), client = prisma): Promise<number> {
  // A day of slack on the cut-off: "due" is decided per user in their own zone below.
  const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const users = await client.recurringTransaction.findMany({
    where: { enabled: true, postMode: RecurringPostMode.AUTO, nextExpectedDate: { lte: cutoff } },
    select: { userId: true },
    distinct: ["userId"],
  });
  let total = 0;
  for (const { userId } of users) {
    total += (await autoPostDueRecurringTransactions(userId, now, client)).posted;
  }
  return total;
}
