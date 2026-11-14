import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { homeCurrencyOf } from "@/lib/home-currency";
import { SAFE_TO_SPEND_BUFFER_MAX_DAYS } from "@/lib/safe-to-spend";
import { loadSafeToSpend, setSafeToSpendBufferDays } from "@/lib/safe-to-spend-data";

/**
 * Safe to spend's settings for the phone (`GET`/`PATCH /api/v1/safe-to-spend`): the bill buffer
 * and zero-based budgeting, the same values the website's Safe to spend card sets, with the
 * number the buffer gives now, so the phone can show the effect of a change straight away.
 */

type SafeToSpendApiUser = { id: string; countryCode: string | null; timezone: string | null };

export async function serializeSafeToSpendSettings(db: PrismaClient, user: SafeToSpendApiUser, now: Date = new Date()) {
  // Only these fields, so the buffer is read fresh: the caller's row may predate a change just saved.
  const [safeToSpend, prefs] = await Promise.all([
    loadSafeToSpend({ id: user.id, countryCode: user.countryCode, timezone: user.timezone }, now, db),
    db.user.findUnique({ where: { id: user.id }, select: { zeroBasedBudgeting: true } }),
  ]);
  return {
    bufferDays: safeToSpend.bufferDays,
    /** The card shows "To assign" (zero-based budgeting) instead of Safe to spend. */
    zeroBased: prefs?.zeroBasedBudgeting ?? false,
    maxBufferDays: SAFE_TO_SPEND_BUFFER_MAX_DAYS,
    currency: homeCurrencyOf(user.countryCode),
    safeToSpend,
  };
}

const BUFFER_MESSAGE = `'bufferDays' must be a whole number of days from 1 to ${SAFE_TO_SPEND_BUFFER_MAX_DAYS}, or null for none.`;

const patchSchema = z
  .object({
    bufferDays: z
      .number(BUFFER_MESSAGE)
      .int(BUFFER_MESSAGE)
      .min(1, BUFFER_MESSAGE)
      .max(SAFE_TO_SPEND_BUFFER_MAX_DAYS, BUFFER_MESSAGE)
      .nullable()
      .optional(),
    zeroBased: z.boolean("'zeroBased' must be true or false.").optional(),
  })
  .strict()
  .refine((body) => body.bufferDays !== undefined || body.zeroBased !== undefined, {
    message: "Send 'bufferDays', 'zeroBased', or both.",
  });

export async function patchSafeToSpendSettingsFromApi(
  db: PrismaClient,
  userId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  if (parsed.data.bufferDays !== undefined) await setSafeToSpendBufferDays(db, userId, parsed.data.bufferDays);
  // The website's zero-based checkbox (`setZeroBasedBudgetingAction`) writes the same column.
  if (parsed.data.zeroBased !== undefined) await db.user.update({ where: { id: userId }, data: { zeroBasedBudgeting: parsed.data.zeroBased } });
  return { ok: true };
}
