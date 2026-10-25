"use server";

import { revalidatePath } from "next/cache";
import { isValidYm } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

function monthOf(formData: FormData): string {
  const ym = getFormValue(formData, "ym");
  if (!isValidYm(ym)) throw new Error("Choose a month.");
  return ym;
}

/** Marks a month reviewed. Idempotent: closing it again keeps the first date. */
export const closeMonthAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const ym = monthOf(formData);
  await prisma.monthClose.upsert({
    where: { userId_ym: { userId: user.id, ym } },
    create: { userId: user.id, ym },
    update: {},
  });
  revalidatePath("/reports/month");
});

export const reopenMonthAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const ym = monthOf(formData);
  await prisma.monthClose.deleteMany({ where: { userId: user.id, ym } });
  revalidatePath("/reports/month");
});
