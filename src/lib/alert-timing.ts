import { DigestFrequency, type PrismaClient } from "@prisma/client";
import { parseBillReminderDays } from "@/lib/bill-reminders";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { latestDigestPeriod } from "@/lib/email-digest";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { hasPushDeviceFor } from "@/lib/push-notifications";

/**
 * When the alerts come, as Settings → Notifications sets it: bill reminders' lead time, the
 * large and unusual charge alerts, the email digest and budget alert emails. Shared by those
 * forms and the phone.
 */

/** Why a change was refused, in words for the person. */
export class AlertTimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertTimingError";
  }
}

type TimingUser = { id: string; timezone: string | null };

export async function loadAlertTiming(db: PrismaClient, userId: string) {
  const [user, charge] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { billReminderDays: true, digestFrequency: true, budgetAlertEmailEnabled: true },
    }),
    db.chargeAlertSetting.findUnique({ where: { userId }, select: { thresholdCents: true, unusual: true } }),
  ]);
  return {
    /** The server can send email; without it, only phones get alerts and the digest is off. */
    emailAvailable: isBudgetAlertEmailConfigured(),
    billReminderDays: user.billReminderDays,
    chargeThresholdCents: charge?.thresholdCents ?? null,
    chargeUnusual: charge?.unusual ?? false,
    digest: user.digestFrequency,
    budgetAlertEmail: user.budgetAlertEmailEnabled,
  };
}

/** How many days before a recurring bill is due to remind, or off (null). */
export async function setBillReminderDays(db: PrismaClient, userId: string, days: number | null): Promise<void> {
  const billReminderDays = parseBillReminderDays(days === null ? "OFF" : String(days));
  if (billReminderDays !== null && !isBudgetAlertEmailConfigured() && !(await hasPushDeviceFor(userId, "billReminders", db))) {
    throw new AlertTimingError("Bill reminders need SMTP on the server, or a phone with bill reminders on under Phone notifications.");
  }
  await db.user.update({ where: { id: userId }, data: { billReminderDays } });
}

/**
 * Large and unusual charge alerts. Turning them on (from off) starts from now, so the bank rows
 * already in the queue are not alerted all at once.
 */
export async function setChargeAlerts(
  db: PrismaClient,
  userId: string,
  setting: { thresholdCents: number | null; unusual: boolean },
): Promise<void> {
  const { thresholdCents, unusual } = setting;
  if (thresholdCents !== null && (!Number.isSafeInteger(thresholdCents) || thresholdCents <= 0)) {
    throw new AlertTimingError("Enter an amount above zero, or leave it empty.");
  }
  const on = thresholdCents !== null || unusual;
  if (on && !isBudgetAlertEmailConfigured() && !(await hasPushDeviceFor(userId, "chargeAlerts", db))) {
    throw new AlertTimingError("Charge alerts need SMTP on the server, or a phone with charge alerts on under Phone notifications.");
  }
  const existing = await db.chargeAlertSetting.findUnique({ where: { userId } });
  const wasOn = existing !== null && (existing.thresholdCents !== null || existing.unusual);
  const checkedThrough = wasOn ? existing.checkedThrough : new Date();
  await db.chargeAlertSetting.upsert({
    where: { userId },
    create: { userId, thresholdCents, unusual, checkedThrough },
    update: { thresholdCents, unusual, checkedThrough },
  });
}

/**
 * How often the spending digest is emailed. Turning it on marks the period just ended as sent,
 * so the first digest arrives at the next Monday or 1st rather than straight away.
 */
export async function setEmailDigest(db: PrismaClient, user: TimingUser, frequency: DigestFrequency): Promise<void> {
  if (frequency !== DigestFrequency.OFF && !isBudgetAlertEmailConfigured()) {
    throw new AlertTimingError("The email digest needs SMTP configured on the server first.");
  }
  const digestLastPeriodKey =
    frequency === DigestFrequency.OFF ? null : latestDigestPeriod(frequency, currentYmdInTimeZone(user.timezone)).key;
  await db.user.update({ where: { id: user.id }, data: { digestFrequency: frequency, digestLastPeriodKey } });
}

/** Budget alert emails on or off; a phone's budget alerts are its own switch. */
export async function setBudgetAlertEmail(db: PrismaClient, userId: string, enabled: boolean): Promise<void> {
  if (enabled && !isBudgetAlertEmailConfigured()) {
    throw new AlertTimingError("Email alerts need SMTP configured on the server first.");
  }
  await db.user.update({ where: { id: userId }, data: { budgetAlertEmailEnabled: enabled } });
}
