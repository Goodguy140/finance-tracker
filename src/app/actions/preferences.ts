"use server";

import { revalidatePath } from "next/cache";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
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
  revalidatePath("/settings");
});
