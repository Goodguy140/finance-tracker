"use server";

import { revalidatePath } from "next/cache";
import { setOwedSharePaid } from "@/lib/owed-to-you";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { setOwedSharePaidSchema } from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

/**
 * Marks what someone owes as paid back, or not. No total changes either way: the share came
 * out of the expense when it was marked as owed, so being repaid is bookkeeping only.
 */
export const setOwedSharePaidAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setOwedSharePaidSchema.parse({
    shareId: getFormValue(formData, "shareId"),
    paid: getFormValue(formData, "paid"),
  });

  if (!(await setOwedSharePaid(prisma, user.id, payload.shareId, payload.paid === "true"))) {
    throw new Error("That owed amount no longer exists.");
  }
  revalidatePath("/");
});
