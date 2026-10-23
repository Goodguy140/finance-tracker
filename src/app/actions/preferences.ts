"use server";

import { revalidatePath } from "next/cache";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
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

/** Hides the dashboard's "Get started" checklist for good. */
export const dismissGetStartedAction = formAction(async () => {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { getStartedDismissedAt: new Date() } });
  revalidatePath("/");
});
