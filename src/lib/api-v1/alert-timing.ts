import { DigestFrequency, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  AlertTimingError,
  loadAlertTiming,
  setBillReminderDays,
  setBudgetAlertEmail,
  setChargeAlerts,
  setEmailDigest,
} from "@/lib/alert-timing";
import { BILL_REMINDER_DAY_OPTIONS } from "@/lib/bill-reminders";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

/** Settings → Notifications' timing for the phone: `GET`/`PATCH /api/v1/alert-timing`. */

const DIGESTS = { off: DigestFrequency.OFF, weekly: DigestFrequency.WEEKLY, monthly: DigestFrequency.MONTHLY } as const;

export async function serializeAlertTiming(db: PrismaClient, userId: string) {
  const timing = await loadAlertTiming(db, userId);
  return {
    ...timing,
    digest: timing.digest.toLowerCase() as keyof typeof DIGESTS,
    billReminderOptions: [...BILL_REMINDER_DAY_OPTIONS],
  };
}

const patchSchema = z
  .object({
    billReminderDays: z
      .number()
      .int()
      .refine((d) => (BILL_REMINDER_DAY_OPTIONS as readonly number[]).includes(d), "'billReminderDays' must be 1, 3 or 7, or null.")
      .nullable()
      .optional(),
    /** The large-charge amount; null leaves that check off. Sent with `chargeUnusual`, or alone to keep it. */
    chargeThresholdCents: z.number().int().min(1, "Enter an amount above zero, or leave it empty.").max(MAX_AMOUNT_CENTS).nullable().optional(),
    chargeUnusual: z.boolean().optional(),
    digest: z.enum(["off", "weekly", "monthly"], "'digest' must be off, weekly or monthly.").optional(),
    budgetAlertEmail: z.boolean().optional(),
  })
  .strict();

export type AlertTimingResult = { ok: true } | { ok: false; error: string };

/** Applies what the body names, in the form's order; a refusal stops there with its reason. */
export async function patchAlertTimingFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string | null },
  body: unknown,
): Promise<AlertTimingResult> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const change = parsed.data;
  try {
    if (change.billReminderDays !== undefined) await setBillReminderDays(db, user.id, change.billReminderDays);
    if (change.chargeThresholdCents !== undefined || change.chargeUnusual !== undefined) {
      const current = await db.chargeAlertSetting.findUnique({ where: { userId: user.id }, select: { thresholdCents: true, unusual: true } });
      await setChargeAlerts(db, user.id, {
        thresholdCents: change.chargeThresholdCents !== undefined ? change.chargeThresholdCents : (current?.thresholdCents ?? null),
        unusual: change.chargeUnusual ?? current?.unusual ?? false,
      });
    }
    if (change.digest !== undefined) await setEmailDigest(db, user, DIGESTS[change.digest]);
    if (change.budgetAlertEmail !== undefined) await setBudgetAlertEmail(db, user.id, change.budgetAlertEmail);
    return { ok: true };
  } catch (err) {
    if (err instanceof AlertTimingError) return { ok: false, error: err.message };
    throw err;
  }
}
