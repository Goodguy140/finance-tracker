"use server";

import { revalidatePath } from "next/cache";
import { setCardTerms, setDebtTerms } from "@/lib/account-edits";
import { parseDueDayInput } from "@/lib/credit-cards";
import { parseAprInput } from "@/lib/debt-payoff";
import { parseCentsInput } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

/** A card's or loan's interest rate and minimum payment, for the payoff plan. Blank clears one. */
export const setDebtTermsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const aprRaw = getFormValue(formData, "apr").trim();
  const minimumRaw = getFormValue(formData, "minimum").trim();
  const interestRateBps = aprRaw ? parseAprInput(aprRaw) : null;
  if (aprRaw && interestRateBps === null) throw new Error("Enter the interest rate as a yearly percentage, like 19.99.");
  const minimumPaymentCents = minimumRaw ? parseCentsInput(minimumRaw) : null;
  if (minimumRaw && minimumPaymentCents === null) {
    throw new Error("Enter the minimum payment as an amount, like 25.00.");
  }
  await setDebtTerms(prisma, user.id, getFormValue(formData, "accountId"), { interestRateBps, minimumPaymentCents });
  revalidatePath("/reports/debt");
});

/** A credit card's limit and payment due day. Blank clears one. */
export const setCardTermsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const limitRaw = getFormValue(formData, "creditLimit").trim();
  const creditLimitCents = limitRaw ? parseCentsInput(limitRaw) : null;
  if (limitRaw && (creditLimitCents === null || creditLimitCents <= 0)) {
    throw new Error("Enter the credit limit as an amount, like 5000.");
  }
  const paymentDueDay = parseDueDayInput(getFormValue(formData, "dueDay"));
  if (paymentDueDay === "invalid") throw new Error("Enter the due day as a day of the month, 1 to 31.");
  await setCardTerms(prisma, user.id, getFormValue(formData, "accountId"), { creditLimitCents, paymentDueDay });
  revalidatePath("/reports", "layout");
  revalidatePath("/settings/accounts");
  revalidatePath("/insights");
});
