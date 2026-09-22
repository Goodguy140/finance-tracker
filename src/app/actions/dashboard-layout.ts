"use server";

import { dashboardLayoutSchema, MAX_LAYOUT_JSON_BYTES } from "@/lib/dashboard-layout/schema";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue, parseJsonField } from "./_helpers";

/**
 * Persist the desktop dashboard arrangement. Called on a debounce as the user drags, so it
 * deliberately does not `revalidatePath("/")`: the dashboard is `force-dynamic` and re-runs
 * every query plus the recurring auto-post on each render, which mid-drag would re-render
 * every card and visibly snap the layout. The client holds the authoritative state; this
 * row is a write-behind cache, read fresh on the next navigation.
 */
export const saveDashboardLayoutAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const raw = getFormValue(formData, "layout");

  // Bounded before parsing: the blob is client-supplied and there is no reason for a
  // legitimate layout to approach this size.
  if (raw.length > MAX_LAYOUT_JSON_BYTES) {
    throw new Error("That dashboard layout is too large to save.");
  }

  const parsed = dashboardLayoutSchema.parse(
    parseJsonField<unknown>(raw, null, "Dashboard layout was not valid JSON."),
  );

  await prisma.dashboardLayout.upsert({
    where: { userId: user.id },
    create: { userId: user.id, layoutJson: JSON.stringify(parsed), version: parsed.version },
    update: { layoutJson: JSON.stringify(parsed), version: parsed.version },
  });
});

/** Drop the saved arrangement so the next render falls back to the default layout. */
export const resetDashboardLayoutAction = formAction(async () => {
  const user = await requireUser();
  await prisma.dashboardLayout.deleteMany({ where: { userId: user.id } });
});
