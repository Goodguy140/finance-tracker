"use server";

import { revalidatePath } from "next/cache";
import { dismissInsight, restoreInsight } from "@/lib/insights/dismiss";
import { loadInsights } from "@/lib/insights/load";
import { fileHabitSeparately, habitMerchants } from "@/lib/insights/track-habit";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { dismissInsightSchema, habitDetectionSchema, insightKeySchema, trackHabitSchema } from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

function revalidateInsights() {
  revalidatePath("/");
  revalidatePath("/insights");
}

export const dismissInsightAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { insightKey, mode } = dismissInsightSchema.parse({
    insightKey: getFormValue(formData, "insightKey"),
    mode: getFormValue(formData, "mode") || undefined,
  });
  await dismissInsight(user, insightKey, mode);
  revalidateInsights();
});

export const restoreInsightAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { insightKey } = insightKeySchema.parse({ insightKey: getFormValue(formData, "insightKey") });
  await restoreInsight(user.id, insightKey);
  revalidateInsights();
});

export const setHabitDetectionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { enabled } = habitDetectionSchema.parse({ enabled: getFormValue(formData, "enabled") });
  await prisma.insightPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, habitDetectionEnabled: enabled },
    update: { habitDetectionEnabled: enabled },
  });
  revalidateInsights();
});

/** Files a habit's purchases under a category of their own (`src/lib/insights/track-habit.ts`). */
export const trackHabitSeparatelyAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { habit } = trackHabitSchema.parse({ habit: getFormValue(formData, "habit") });
  const found = habitMerchants(await loadInsights(user.id, user.countryCode, user.timezone), habit);
  if (!found.ok) throw new Error(found.error);
  await fileHabitSeparately(prisma, user.id, habit, found.merchants);
  revalidateInsights();
  revalidatePath("/settings", "layout");
});
