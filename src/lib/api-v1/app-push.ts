import type { AppPushToken, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { APNS_TOKEN_PATTERN } from "@/lib/apns";
import { getApnsCredentials } from "@/lib/apns-settings";

/**
 * The phone app's alert registration (`/api/v1/app/device/push`): its Apple push token and which
 * alerts it wants. One per signed-in phone (`AppPushToken`), gone when the phone signs out.
 */

const alertsSchema = z.object(
  {
    billReminders: z.boolean("'billReminders' must be true or false.").optional(),
    chargeAlerts: z.boolean("'chargeAlerts' must be true or false.").optional(),
    budgetAlerts: z.boolean("'budgetAlerts' must be true or false.").optional(),
  },
  "'alerts' must be an object.",
);

const registrationSchema = z.object({
  token: z
    .string("'token' is required.")
    .trim()
    .toLowerCase()
    .regex(APNS_TOKEN_PATTERN, "'token' must be the phone's APNs device token, in hex."),
  environment: z.enum(["production", "development"], "'environment' must be production or development.").default("production"),
  alerts: alertsSchema.optional(),
  hideAmounts: z.boolean("'hideAmounts' must be true or false.").optional(),
});

export type PushRegistration = z.infer<typeof registrationSchema>;

export function parsePushRegistration(body: unknown): { ok: true; value: PushRegistration } | { ok: false; error: string } {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid registration." };
  return { ok: true, value: parsed.data };
}

export function serializePushRegistration(row: AppPushToken) {
  return {
    environment: row.environment,
    alerts: { billReminders: row.billReminders, chargeAlerts: row.chargeAlerts, budgetAlerts: row.budgetAlerts },
    hideAmounts: row.hideAmounts,
  };
}

type Db = Pick<PrismaClient, "appPushToken" | "$transaction">;

/**
 * Saves this phone's token and switches. Alerts left out keep their value (on, for a new
 * registration). A token another sign-in still holds moves here: the phone now belongs to this
 * sign-in, and the old one's alerts must not reach it.
 */
export async function registerAppPush(db: Db, device: { id: string; userId: string }, input: PushRegistration) {
  const fields = {
    token: input.token,
    environment: input.environment,
    ...input.alerts,
    ...(input.hideAmounts === undefined ? {} : { hideAmounts: input.hideAmounts }),
  };
  const [, row] = await db.$transaction([
    db.appPushToken.deleteMany({ where: { token: input.token, appDeviceId: { not: device.id } } }),
    db.appPushToken.upsert({
      where: { appDeviceId: device.id },
      create: { appDeviceId: device.id, userId: device.userId, ...fields },
      update: { ...fields, failureCount: 0 },
    }),
  ]);
  return serializePushRegistration(row);
}

/** This phone's registration, and whether the server can send to it at all. */
export async function appPushStatus(db: Pick<PrismaClient, "appPushToken" | "serverSetting">, deviceId: string) {
  const [row, credentials] = await Promise.all([
    db.appPushToken.findUnique({ where: { appDeviceId: deviceId } }),
    getApnsCredentials(db),
  ]);
  return { available: credentials !== null, registration: row ? serializePushRegistration(row) : null };
}
