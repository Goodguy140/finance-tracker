import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { homeCurrencyOf } from "@/lib/home-currency";
import { SAFE_TO_SPEND_BUFFER_MAX_DAYS } from "@/lib/safe-to-spend";
import { loadSafeToSpend, setSafeToSpendBufferDays } from "@/lib/safe-to-spend-data";

/**
 * Safe to spend's buffer for the phone (`GET`/`PATCH /api/v1/safe-to-spend`): the same value the
 * website's Safe to spend card sets, with the number it gives now, so the phone can show the
 * effect of a change straight away.
 */

type SafeToSpendApiUser = { id: string; countryCode: string | null; timezone: string | null };

export async function serializeSafeToSpendSettings(db: PrismaClient, user: SafeToSpendApiUser, now: Date = new Date()) {
  // Only these fields, so the buffer is read fresh: the caller's row may predate a change just saved.
  const safeToSpend = await loadSafeToSpend({ id: user.id, countryCode: user.countryCode, timezone: user.timezone }, now, db);
  return {
    bufferDays: safeToSpend.bufferDays,
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
      .nullable(),
  })
  .strict();

export async function patchSafeToSpendSettingsFromApi(
  db: PrismaClient,
  userId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  await setSafeToSpendBufferDays(db, userId, parsed.data.bufferDays);
  return { ok: true };
}
