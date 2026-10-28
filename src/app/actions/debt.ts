"use server";

import { revalidatePath } from "next/cache";
import { AccountType } from "@prisma/client";
import { parseDueDayInput } from "@/lib/credit-cards";
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

/** A credit card's limit and payment due day. Blank clears one. */
export const setCardTermsAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const account = await prisma.account.findFirst({
    where: { id: getFormValue(formData, "accountId"), userId: user.id },
    select: { id: true, type: true, paymentDueDay: true },
  });
  if (!account || account.type !== AccountType.CREDIT_CARD) throw new Error("Only credit cards have a limit and due day.");

  const limitRaw = getFormValue(formData, "creditLimit").trim();
  const creditLimitCents = limitRaw ? parseCentsInput(limitRaw) : null;
  if (limitRaw && (creditLimitCents === null || creditLimitCents <= 0)) {
    throw new Error("Enter the credit limit as an amount, like 5000.");
  }
  const paymentDueDay = parseDueDayInput(getFormValue(formData, "dueDay"));
  if (paymentDueDay === "invalid") throw new Error("Enter the due day as a day of the month, 1 to 31.");
  await prisma.account.update({
    where: { id: account.id },
    data: {
      creditLimitCents,
      paymentDueDay,
      // A new due day is a new schedule: its first date has not been reminded.
      ...(paymentDueDay !== account.paymentDueDay ? { paymentRemindedFor: null } : {}),
    },
  });
  revalidatePath("/reports", "layout");
  revalidatePath("/settings/accounts");
  revalidatePath("/insights");
});
