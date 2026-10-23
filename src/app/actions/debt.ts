"use server";

import { revalidatePath } from "next/cache";
import { parseAprInput } from "@/lib/debt-payoff";
import { isLiabilityType } from "@/lib/net-worth";
import { parseCentsInput } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

/** A card's or loan's interest rate and minimum payment, for the payoff plan. Blank clears one. */
export const setDebtTermsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const account = await prisma.account.findFirst({
    where: { id: getFormValue(formData, "accountId"), userId: user.id },
    select: { id: true, type: true },
  });
  if (!account || !isLiabilityType(account.type)) throw new Error("Only credit cards and loans have a payoff plan.");

  const aprRaw = getFormValue(formData, "apr").trim();
  const minimumRaw = getFormValue(formData, "minimum").trim();
  const interestRateBps = aprRaw ? parseAprInput(aprRaw) : null;
  if (aprRaw && interestRateBps === null) throw new Error("Enter the interest rate as a yearly percentage, like 19.99.");
  const minimumPaymentCents = minimumRaw ? parseCentsInput(minimumRaw) : null;
  if (minimumRaw && minimumPaymentCents === null) {
    throw new Error("Enter the minimum payment as an amount, like 25.00.");
  }
  await prisma.account.update({ where: { id: account.id }, data: { interestRateBps, minimumPaymentCents } });
  revalidatePath("/reports/debt");
});
