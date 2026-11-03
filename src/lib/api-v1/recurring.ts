import { type PrismaClient, type RecurringCadence, type RecurringPostMode, type TransactionType } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import type { SkipReason } from "@/lib/recurring-skip";

/**
 * Recurring bills, pay and transfers as `/api/v1/recurring` gives them to the phone app: every rule
 * that is on, soonest first, each with the occurrence it is waiting on. Posting and skipping that
 * occurrence go through `postRecurringOccurrence` and `skipRecurringOccurrence`, the functions
 * behind the website's Post and Skip buttons.
 */

const TYPE = { EXPENSE: "expense", INCOME: "income", TRANSFER: "transfer" } as const;

type RuleRow = {
  id: string;
  name: string;
  type: TransactionType;
  amountCents: number;
  cadence: RecurringCadence;
  nextExpectedDate: Date;
  endDate: Date | null;
  postMode: RecurringPostMode;
  account: { name: string; currency: string };
  transferAccount: { name: string } | null;
  category: { name: string };
};

export function serializeRecurringRule(rule: RuleRow, todayYmd: string) {
  const date = ymdFromDateUtc(rule.nextExpectedDate);
  return {
    id: rule.id,
    name: rule.name,
    type: TYPE[rule.type],
    amountCents: rule.amountCents,
    currency: rule.account.currency,
    cadence: rule.cadence.toLowerCase() as Lowercase<RecurringCadence>,
    /** The occurrence the rule is waiting on, the one Post and Skip act on. */
    date,
    status: date < todayYmd ? ("overdue" as const) : date === todayYmd ? ("due" as const) : ("upcoming" as const),
    account: rule.account.name,
    toAccount: rule.type === "TRANSFER" ? (rule.transferAccount?.name ?? null) : null,
    category: rule.type === "TRANSFER" ? null : rule.category.name,
    /** Posts itself when due (and waits in Needs review), unless posted or skipped first. */
    autoPost: rule.postMode === "AUTO",
    endDate: rule.endDate ? ymdFromDateUtc(rule.endDate) : null,
  };
}

export type AppRecurringRule = ReturnType<typeof serializeRecurringRule>;

export async function loadAppRecurring(
  user: { id: string; timezone: string | null },
  now: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<{ today: string; rules: AppRecurringRule[] }> {
  const today = currentYmdInTimeZone(user.timezone, now);
  const rules = await client.recurringTransaction.findMany({
    where: { userId: user.id, enabled: true },
    orderBy: [{ nextExpectedDate: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      amountCents: true,
      cadence: true,
      nextExpectedDate: true,
      endDate: true,
      postMode: true,
      account: { select: { name: true, currency: true } },
      transferAccount: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  return { today, rules: rules.map((rule) => serializeRecurringRule(rule, today)) };
}

/** A calendar date, and a real one: 2026-02-30 is refused rather than rolled into March. */
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expectedDate must be YYYY-MM-DD.")
  .refine((value) => ymdFromDateUtc(dateFromYmd(value)) === value, "expectedDate is not a calendar date.");

const postBody = z.object({ expectedDate: ymd });
const skipBody = z.object({ expectedDate: ymd, reason: z.enum(["skip_once", "already_logged"]).default("skip_once") });

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid body." };
}

/** `{ "expectedDate": "YYYY-MM-DD" }`: the occurrence to post, so a stale screen cannot post a different one. */
export function parsePostBody(body: unknown): Parsed<{ expectedDate: string }> {
  return parse(postBody, body);
}

/**
 * `{ "expectedDate", "reason" }`: `skip_once` (the default) moves past the occurrence;
 * `already_logged` first links the entry the person logged themselves, matched by the rule's name
 * within 15 days, as the website's "I already logged it" does without a pick.
 */
export function parseSkipBody(body: unknown): Parsed<{ expectedDate: string; reason: SkipReason }> {
  return parse(skipBody, body);
}
