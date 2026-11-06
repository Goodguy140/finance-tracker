import { CategoryKind, TransactionType, type PrismaClient, type RecurringCadence, type RecurringPostMode } from "@prisma/client";
import { dateFromYmd } from "@/lib/date-only";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { DEFAULT_SEMI_MONTHLY_DAYS, firstSemiMonthlyDateOnOrAfter, isValidSemiMonthlyDays } from "@/lib/recurring-transactions";
import { parseCancelFields } from "@/lib/subscription-cancel";

/**
 * Adding, changing, pausing, deleting and cancelling a recurring rule, shared by the website's
 * Recurring card (`src/app/actions/recurring.ts`) and the phone (`/api/v1/recurring`), so a rule
 * saves the same way from both: its category and other account checked, its schedule worked out
 * from the date entered, and the cancel helper's fields kept to bills.
 */

export class RecurringRuleError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "RecurringRuleError";
  }
}

export type RecurringRuleInput = {
  type: TransactionType;
  /** Where the money books to; for a transfer, the account it leaves. */
  accountId: string;
  /** Required for bills and income. A transfer goes to the user's Transfers category. */
  categoryId?: string;
  /** A transfer's other side: the account the money goes to. Ignored for bills and income. */
  transferAccountId?: string;
  name: string;
  amountCents: number;
  cadence: RecurringCadence;
  /** YYYY-MM-DD as entered; a twice-a-month rule starts on the first of its days on or after it. */
  nextExpectedDate: string;
  firstDay?: number;
  secondDay?: number;
  beforeWeekend?: boolean;
  endDate?: string | null;
  note?: string | null;
  postMode: RecurringPostMode;
  /** The cancel helper's two fields, as typed. Left out, what is stored stays (an older form). */
  cancel?: { cancelUrl: string; decideBy: string };
};

type Db = PrismaClient;

async function assertActiveAccount(db: Db, userId: string, accountId: string) {
  const account = await db.account.findFirst({ where: { id: accountId, userId, archived: false }, select: { id: true } });
  if (!account) throw new RecurringRuleError("Selected account was not found or is archived.");
}

/**
 * The category and other account a rule saves with, checked against the user. A bill or income
 * rule names its own category; a transfer goes to the Transfers category and names the account
 * the money goes to, which must be another of the user's active accounts.
 */
async function resolveRuleSides(db: Db, userId: string, input: RecurringRuleInput) {
  if (input.type === TransactionType.TRANSFER) {
    if (!input.transferAccountId) throw new RecurringRuleError("Choose the account the transfer goes to.");
    if (input.transferAccountId === input.accountId) throw new RecurringRuleError("Choose two different accounts.");
    await Promise.all([assertActiveAccount(db, userId, input.accountId), assertActiveAccount(db, userId, input.transferAccountId)]);
    const categoryId = await ensureFallbackCategoryFor(db, userId, CategoryKind.TRANSFER);
    return { categoryId, transferAccountId: input.transferAccountId };
  }
  if (!input.categoryId) throw new RecurringRuleError("Choose a category.");
  // The two enums share their values: each transaction type has categories of its own kind.
  const kind = input.type as CategoryKind;
  const [category] = await Promise.all([
    db.category.findFirst({ where: { id: input.categoryId, userId, kind }, select: { id: true } }),
    assertActiveAccount(db, userId, input.accountId),
  ]);
  if (!category) throw new RecurringRuleError("Selected category was not found.");
  return { categoryId: input.categoryId, transferAccountId: null };
}

/**
 * Where a rule's dates land. A twice-a-month rule falls on its two days, and starts on the first
 * of them on or after the date entered. Any other rule falls on its next date's day of the month.
 */
function scheduleFor(input: RecurringRuleInput, entered: Date) {
  if (input.cadence !== "SEMI_MONTHLY") {
    return { nextExpectedDate: entered, anchorDay: entered.getUTCDate(), secondAnchorDay: null, beforeWeekend: false };
  }
  const days = {
    day: input.firstDay ?? DEFAULT_SEMI_MONTHLY_DAYS.day,
    secondDay: input.secondDay ?? DEFAULT_SEMI_MONTHLY_DAYS.secondDay,
    beforeWeekend: input.beforeWeekend === true,
  };
  if (!isValidSemiMonthlyDays(days.day, days.secondDay)) {
    throw new RecurringRuleError("Choose two days at least a week apart, the second later in the month.");
  }
  return {
    nextExpectedDate: firstSemiMonthlyDateOnOrAfter(entered, days),
    anchorDay: days.day,
    secondAnchorDay: days.secondDay,
    beforeWeekend: days.beforeWeekend,
  };
}

/** Only bills carry a cancel link and decide-by date; income and transfers clear them. */
function cancelFieldsFor(input: RecurringRuleInput) {
  if (input.type !== TransactionType.EXPENSE) return { cancelUrl: null, decideBy: null };
  if (!input.cancel) return {};
  try {
    return parseCancelFields(input.cancel);
  } catch (err) {
    throw new RecurringRuleError(err instanceof Error ? err.message : "Check the cancel link and decide-by date.");
  }
}

async function prepare(db: Db, userId: string, input: RecurringRuleInput) {
  const sides = await resolveRuleSides(db, userId, input);
  const schedule = scheduleFor(input, dateFromYmd(input.nextExpectedDate));
  const endDate = input.endDate ? dateFromYmd(input.endDate) : null;
  if (endDate && endDate.getTime() < schedule.nextExpectedDate.getTime()) {
    throw new RecurringRuleError("End date must be on or after the next expected date.");
  }
  return {
    sides,
    schedule,
    fields: {
      ...cancelFieldsFor(input),
      accountId: input.accountId,
      categoryId: sides.categoryId,
      transferAccountId: sides.transferAccountId,
      type: input.type,
      name: input.name.trim(),
      amountCents: input.amountCents,
      cadence: input.cadence,
      endDate,
      postMode: input.postMode,
      note: input.note || null,
    },
  };
}

/** Adds a rule. @throws RecurringRuleError */
export async function createRecurringRule(db: Db, userId: string, input: RecurringRuleInput): Promise<string> {
  const { schedule, fields } = await prepare(db, userId, input);
  const created = await db.recurringTransaction.create({ data: { ...fields, ...schedule, userId } });
  return created.id;
}

/** Replaces a rule's fields. @throws RecurringRuleError */
export async function updateRecurringRule(db: Db, userId: string, ruleId: string, input: RecurringRuleInput): Promise<void> {
  const existing = await db.recurringTransaction.findFirst({
    where: { id: ruleId, userId },
    select: { id: true, nextExpectedDate: true, cadence: true },
  });
  if (!existing) throw new RecurringRuleError("Recurring transaction not found.", true);
  const { schedule, fields } = await prepare(db, userId, input);
  const { anchorDay, ...rest } = schedule;
  await db.recurringTransaction.update({
    where: { id: existing.id },
    data: {
      ...fields,
      ...rest,
      // A new date sets the day the rule falls on. An unchanged one keeps the anchor, which
      // can be later than the date shown (a rule on the 31st waiting on Feb 28). A
      // twice-a-month rule's days are chosen in the form, so they are always saved, and its
      // first day is no anchor for a rule it is changed to.
      ...(input.cadence !== "SEMI_MONTHLY" &&
      existing.cadence !== "SEMI_MONTHLY" &&
      existing.nextExpectedDate.getTime() === rest.nextExpectedDate.getTime()
        ? {}
        : { anchorDay }),
    },
  });
}

/** Pauses a rule, or turns it back on. Turning a cancelled subscription back on means it was not cancelled after all. */
export async function setRecurringRuleEnabled(db: Db, userId: string, ruleId: string, enabled: boolean): Promise<void> {
  const { count } = await db.recurringTransaction.updateMany({
    where: { id: ruleId, userId },
    data: enabled ? { enabled: true, cancelledAt: null } : { enabled: false },
  });
  if (count === 0) throw new RecurringRuleError("Recurring transaction not found.", true);
}

/** Deletes a rule. What it posted stays in the log. */
export async function deleteRecurringRule(db: Db, userId: string, ruleId: string): Promise<void> {
  const { count } = await db.recurringTransaction.deleteMany({ where: { id: ruleId, userId } });
  if (count === 0) throw new RecurringRuleError("Recurring transaction not found.", true);
}

/**
 * "Cancel subscription": the user has cancelled it with the provider. The rule is turned off and
 * the date kept, so Insights can show what it saves; turning it back on undoes both.
 */
export async function cancelSubscription(db: Db, userId: string, ruleId: string, now: Date = new Date()): Promise<void> {
  const { count } = await db.recurringTransaction.updateMany({
    where: { id: ruleId, userId, type: TransactionType.EXPENSE },
    data: { enabled: false, cancelledAt: now },
  });
  if (count === 0) throw new RecurringRuleError("Recurring bill not found.", true);
}
