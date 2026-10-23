"use server";

import { revalidatePath } from "next/cache";
import { BALANCE_SOURCE } from "@/lib/account-balances";
import { dateFromYmd } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { loadReconcileInputs, parseBalanceInput, reconcile } from "@/lib/reconciliation";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Records that a statement agreed with the log. Worked out again here rather than trusting the
 * page, and refused unless it balances to the cent. The closing balance is also kept as the
 * account's balance on the statement's last day, unless the bank already reported one for it.
 */
export const saveReconciliationAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const accountId = getFormValue(formData, "accountId");
  const startYmd = getFormValue(formData, "from");
  const endYmd = getFormValue(formData, "to");
  const openingCents = parseBalanceInput(getFormValue(formData, "opening"));
  const closingCents = parseBalanceInput(getFormValue(formData, "closing"));
  if (!YMD.test(startYmd) || !YMD.test(endYmd) || startYmd > endYmd) throw new Error("Choose the statement's dates.");
  if (openingCents === null || closingCents === null) throw new Error("Enter both balances from the statement.");

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: user.id },
    select: { id: true, name: true, type: true, currency: true },
  });
  if (!account) throw new Error("Account not found.");
  const inputs = await loadReconcileInputs(prisma, user.id, account, startYmd, endYmd);
  const result = reconcile({ accountId, liability: inputs.liability, openingCents, closingCents, transactions: inputs.transactions });
  if (result.differenceCents !== 0) throw new Error("The log does not match this statement yet.");

  const endDate = dateFromYmd(endYmd);
  await prisma.$transaction(async (tx) => {
    await tx.accountReconciliation.create({
      data: { userId: user.id, accountId, startDate: dateFromYmd(startYmd), endDate, openingCents, closingCents },
    });
    const existing = await tx.accountBalanceSnapshot.findUnique({
      where: { accountId_date: { accountId, date: endDate } },
      select: { source: true },
    });
    if (existing?.source !== BALANCE_SOURCE.plaid) {
      await tx.accountBalanceSnapshot.upsert({
        where: { accountId_date: { accountId, date: endDate } },
        create: { userId: user.id, accountId, date: endDate, balanceCents: closingCents, source: BALANCE_SOURCE.manual },
        update: { balanceCents: closingCents, source: BALANCE_SOURCE.manual },
      });
    }
  });
  revalidatePath("/settings", "layout");
  revalidatePath("/reports");
});

export const deleteReconciliationAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const removed = await prisma.accountReconciliation.deleteMany({
    where: { id: getFormValue(formData, "reconciliationId"), userId: user.id },
  });
  if (removed.count === 0) throw new Error("Reconciliation not found.");
  revalidatePath("/settings", "layout");
});
