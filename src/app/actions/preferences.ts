"use server";

import { revalidatePath } from "next/cache";
import { DigestFrequency } from "@prisma/client";
import { parseBillReminderDays } from "@/lib/bill-reminders";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { parseChargeAlertThreshold } from "@/lib/charge-alerts";
import { latestDigestPeriod, sendDigestPreview } from "@/lib/email-digest";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { MIN_BUDGET_NAME_VISIBLE_PCT, MIN_TEXT_VISIBLE_PCT, parseVisiblePct } from "@/lib/dashboard-readability";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

/** Opt in or out of budget alert emails; the preference lives on the user row. */
export const setBudgetAlertEmailAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const enabled = getFormValue(formData, "enabled") === "true";
  if (enabled && !isBudgetAlertEmailConfigured()) {
    throw new Error("Email alerts need SMTP configured on the server first.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { budgetAlertEmailEnabled: enabled } });
  revalidatePath("/settings", "layout");
});

/** How much text the dashboard keeps readable before merging a column away. */
export const updateDashboardReadabilityAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const dashboardTextVisiblePct = parseVisiblePct(
    getFormValue(formData, "textVisiblePct"),
    "Card text",
    MIN_TEXT_VISIBLE_PCT,
  );
  const dashboardBudgetNameVisiblePct = parseVisiblePct(
    getFormValue(formData, "budgetNameVisiblePct"),
    "Budget names",
    MIN_BUDGET_NAME_VISIBLE_PCT,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { dashboardTextVisiblePct, dashboardBudgetNameVisiblePct },
  });
  revalidatePath("/settings", "layout");
  revalidatePath("/");
});

/** Whether projected balances apply recurring transfers between the user's accounts. */
export const setProjectionIncludesTransfersAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const enabled = getFormValue(formData, "enabled") === "true";
  await prisma.user.update({ where: { id: user.id }, data: { projectionIncludesTransfers: enabled } });
  revalidatePath("/reports", "layout");
  revalidatePath("/insights");
  revalidatePath("/");
});

/** Opt in or out of zero-based budgeting; the dashboard's Safe to spend card shows "To assign" instead. */
export const setZeroBasedBudgetingAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const enabled = getFormValue(formData, "enabled") === "true";
  await prisma.user.update({ where: { id: user.id }, data: { zeroBasedBudgeting: enabled } });
  revalidatePath("/");
});

/** Hides the dashboard's "Get started" checklist for good. */
export const dismissGetStartedAction = formAction(async () => {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { getStartedDismissedAt: new Date() } });
  revalidatePath("/");
});

/**
 * How often the spending digest is emailed. Turning it on marks the period just ended as sent,
 * so the first digest arrives at the next Monday or 1st rather than straight away.
 */
export const setEmailDigestAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const raw = getFormValue(formData, "frequency");
  if (raw !== "OFF" && raw !== "WEEKLY" && raw !== "MONTHLY") throw new Error("Choose how often to get the digest.");
  const frequency = raw as DigestFrequency;
  if (frequency !== "OFF" && !isBudgetAlertEmailConfigured()) {
    throw new Error("The email digest needs SMTP configured on the server first.");
  }
  const digestLastPeriodKey =
    frequency === "OFF" ? null : latestDigestPeriod(frequency, currentYmdInTimeZone(user.timezone)).key;
  await prisma.user.update({ where: { id: user.id }, data: { digestFrequency: frequency, digestLastPeriodKey } });
  revalidatePath("/settings", "layout");
});

/** Emails the latest digest now, so the user can see what they will get. */
export const sendEmailDigestPreviewAction = formAction(async () => {
  const user = await requireUser();
  const result = await sendDigestPreview(user.id);
  if (result !== "sent") throw new Error("The email could not be sent. SMTP may not be configured on the server.");
});

/** How many days before a recurring bill is due to email a reminder, or off. */
export const setBillRemindersAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const billReminderDays = parseBillReminderDays(getFormValue(formData, "days"));
  if (billReminderDays !== null && !isBudgetAlertEmailConfigured()) {
    throw new Error("Bill reminders need SMTP configured on the server first.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { billReminderDays } });
  revalidatePath("/settings", "layout");
});

/**
 * Large and unusual charge alerts. Turning them on (from off) starts from now, so the bank rows
 * already in the queue are not emailed all at once.
 */
export const setChargeAlertsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const thresholdCents = parseChargeAlertThreshold(getFormValue(formData, "threshold"));
  const unusual = getFormValue(formData, "unusual") === "true";
  const on = thresholdCents !== null || unusual;
  if (on && !isBudgetAlertEmailConfigured()) {
    throw new Error("Charge alerts need SMTP configured on the server first.");
  }
  const existing = await prisma.chargeAlertSetting.findUnique({ where: { userId: user.id } });
  const wasOn = existing !== null && (existing.thresholdCents !== null || existing.unusual);
  const checkedThrough = wasOn ? existing.checkedThrough : new Date();
  await prisma.chargeAlertSetting.upsert({
    where: { userId: user.id },
    create: { userId: user.id, thresholdCents, unusual, checkedThrough },
    update: { thresholdCents, unusual, checkedThrough },
  });
  revalidatePath("/settings", "layout");
});
