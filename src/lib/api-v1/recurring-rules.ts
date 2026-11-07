import { RecurringPostMode, TransactionType, type PrismaClient, type RecurringCadence } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { createRecurringRule, RecurringRuleError, updateRecurringRule, type RecurringRuleInput } from "@/lib/recurring-rules";
import { MAX_CANCEL_URL_LENGTH } from "@/lib/subscription-cancel";

/**
 * Recurring rules added and changed from the phone, saved by the website's own
 * `src/lib/recurring-rules.ts`. The body is the website's Recurring form in JSON.
 */

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.")
  .refine((value) => ymdFromDateUtc(dateFromYmd(value)) === value, "That date does not exist.");

const TYPES = { expense: TransactionType.EXPENSE, income: TransactionType.INCOME, transfer: TransactionType.TRANSFER } as const;
const CADENCES = ["weekly", "biweekly", "semi_monthly", "monthly", "quarterly", "yearly", "biennial"] as const;

const ruleSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer"]),
    accountId: z.string().min(1, "Choose an account."),
    categoryId: z.string().min(1).nullable().optional(),
    transferAccountId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(2, "Give the rule a name of at least 2 characters.").max(80),
    amountCents: z.number().int().min(1, "The amount must be positive.").max(MAX_AMOUNT_CENTS),
    cadence: z.enum(CADENCES),
    /** The next date it is expected; a twice-a-month rule starts on its first day on or after it. */
    nextExpectedDate: ymd,
    firstDay: z.number().int().min(1).max(31).nullable().optional(),
    secondDay: z.number().int().min(1).max(31).nullable().optional(),
    beforeWeekend: z.boolean().optional(),
    endDate: ymd.nullable().optional(),
    note: z.string().trim().max(250).nullable().optional(),
    /** Posted to the log when due, with no tap needed (the website's "Post automatically"). */
    autoPost: z.boolean().default(false),
    /** Bills only; both left out keeps what is stored. */
    cancelUrl: z.string().max(MAX_CANCEL_URL_LENGTH).nullable().optional(),
    decideBy: ymd.nullable().optional(),
  })
  .strict();

export type RuleResult = { ok: true; id: string } | { ok: false; status: 400 | 404; error: string };

function parseRule(body: unknown): { ok: true; input: RecurringRuleInput } | { ok: false; status: 400; error: string } {
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid rule." };
  const rule = parsed.data;
  const keepsCancel = rule.cancelUrl === undefined && rule.decideBy === undefined;
  return {
    ok: true,
    input: {
      type: TYPES[rule.type],
      accountId: rule.accountId,
      categoryId: rule.categoryId ?? undefined,
      transferAccountId: rule.transferAccountId ?? undefined,
      name: rule.name,
      amountCents: rule.amountCents,
      cadence: rule.cadence.toUpperCase() as RecurringCadence,
      nextExpectedDate: rule.nextExpectedDate,
      firstDay: rule.firstDay ?? undefined,
      secondDay: rule.secondDay ?? undefined,
      beforeWeekend: rule.beforeWeekend ?? false,
      endDate: rule.endDate ?? null,
      note: rule.note || null,
      postMode: rule.autoPost ? RecurringPostMode.AUTO : RecurringPostMode.REVIEW,
      cancel: keepsCancel ? undefined : { cancelUrl: rule.cancelUrl ?? "", decideBy: rule.decideBy ?? "" },
    },
  };
}

/** A RecurringRuleError as the response it stands for; anything else is a bug and is rethrown. */
export function ruleRefusal(err: unknown): { ok: false; status: 400 | 404; error: string } {
  if (err instanceof RecurringRuleError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

export async function createRuleFromApi(db: PrismaClient, userId: string, body: unknown): Promise<RuleResult> {
  const parsed = parseRule(body);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, id: await createRecurringRule(db, userId, parsed.input) };
  } catch (err) {
    return ruleRefusal(err);
  }
}

/** Replaces every field of the rule, as the website's Save changes does. */
export async function updateRuleFromApi(db: PrismaClient, userId: string, ruleId: string, body: unknown): Promise<RuleResult> {
  const parsed = parseRule(body);
  if (!parsed.ok) return parsed;
  try {
    await updateRecurringRule(db, userId, ruleId, parsed.input);
    return { ok: true, id: ruleId };
  } catch (err) {
    return ruleRefusal(err);
  }
}

/** `{ "enabled": true | false }`: turn a rule back on, or pause it. */
export function parseEnabledBody(body: unknown): { ok: true; enabled: boolean } | { ok: false; error: string } {
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(body);
  return parsed.success ? { ok: true, enabled: parsed.data.enabled } : { ok: false, error: "Send { enabled: true } or { enabled: false }." };
}
