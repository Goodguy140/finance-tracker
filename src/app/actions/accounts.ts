"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { formatAccountDetachedLabel } from "@/lib/account-type-labels";
import { defaultCountsAsSavings } from "@/lib/savings-transfers";
import { mergeAccountDescriptionOnDetach } from "@/lib/transaction-account-detach";
import {
  accountSchema,
  setAccountArchivedSchema,
  updateAccountSchema,
  updateDefaultExpenseAccountSchema,
} from "@/lib/validation";
import {
  getFormValue,
  formAction,
} from "./_helpers";
export const createFinancialAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = accountSchema.parse({
    name: getFormValue(formData, "name"),
    type: getFormValue(formData, "type"),
  });

  const created = await prisma.account.create({
    data: {
      userId: user.id,
      name: payload.name,
      type: payload.type as AccountType,
      countsAsSavings: defaultCountsAsSavings(payload.type),
      countryCode: user.countryCode,
      archived: false,
    },
    select: { id: true },
  });
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.financial_account_created,
    targetType: "Account",
    targetId: created.id,
    headers: h,
  });
  revalidatePath("/");
  revalidatePath("/settings");
});

export const updateFinancialAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateAccountSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    name: getFormValue(formData, "name"),
    type: getFormValue(formData, "type"),
    currency: getFormValue(formData, "currency"),
    countsAsSavings: formData.get("countsAsSavings") === "on",
  });

  const result = await prisma.account.updateMany({
    where: { id: payload.accountId, userId: user.id },
    data: {
      name: payload.name,
      type: payload.type as AccountType,
      currency: payload.currency,
      countsAsSavings: payload.countsAsSavings,
    },
  });
  if (result.count === 0) throw new Error("Account not found.");

  revalidatePath("/");
  revalidatePath("/settings");
});

export const updateDefaultExpenseAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateDefaultExpenseAccountSchema.parse({
    defaultExpenseAccountId: getFormValue(formData, "defaultExpenseAccountId"),
  });

  if (payload.defaultExpenseAccountId == null) {
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: null },
    });
  } else {
    const account = await prisma.account.findFirst({
      where: {
        id: payload.defaultExpenseAccountId,
        userId: user.id,
        archived: false,
      },
      select: { id: true },
    });
    if (!account) {
      throw new Error("Pick an active account you own, or clear the default.");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: account.id },
    });
  }

  revalidatePath("/");
  revalidatePath("/settings");
});

export const deleteFinancialAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const accountId = getFormValue(formData, "accountId");
  if (!accountId) throw new Error("Account id is required.");

  const recurringTransactionCount = await prisma.recurringTransaction.count({ where: { userId: user.id, accountId } });
  const investmentFlowCount = await prisma.investmentFlow.count({ where: { userId: user.id, accountId } });
  const snapshotCount = await prisma.portfolioSnapshot.count({ where: { userId: user.id, accountId } });
  if (recurringTransactionCount + investmentFlowCount + snapshotCount > 0) {
    throw new Error(
      "This account still has recurring transactions, investment flows, or portfolio snapshots. Remove or reassign them first, then try again.",
    );
  }

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: user.id },
    select: { id: true, name: true, type: true },
  });
  if (!account) throw new Error("Account not found.");

  const removedLabel = formatAccountDetachedLabel(account.name, account.type);

  await prisma.$transaction(async (tx) => {
    const rows = await tx.transaction.findMany({
      where: { userId: user.id, accountId },
      select: { id: true, accountDescription: true },
    });
    for (const row of rows) {
      await tx.transaction.update({
        where: { id: row.id },
        data: {
          account: { disconnect: true },
          accountDescription: mergeAccountDescriptionOnDetach(row.accountDescription, removedLabel),
        },
      });
    }
    await tx.user.updateMany({
      where: { id: user.id, defaultExpenseAccountId: account.id },
      data: { defaultExpenseAccountId: null },
    });
    await tx.account.delete({ where: { id: account.id } });
  });

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.financial_account_deleted,
    targetType: "Account",
    targetId: account.id,
    headers: h,
  });

  revalidatePath("/");
  revalidatePath("/settings");
});

export const setFinancialAccountArchivedAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setAccountArchivedSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    archived: getFormValue(formData, "archived"),
  });
  const archived = payload.archived === "true";

  if (archived) {
    const [recurringTransactionCount, investmentFlowCount, snapshotCount] = await Promise.all([
      prisma.recurringTransaction.count({ where: { userId: user.id, accountId: payload.accountId } }),
      prisma.investmentFlow.count({ where: { userId: user.id, accountId: payload.accountId } }),
      prisma.portfolioSnapshot.count({ where: { userId: user.id, accountId: payload.accountId } }),
    ]);
    if (recurringTransactionCount + investmentFlowCount + snapshotCount > 0) {
      throw new Error(
        "Cannot archive while this account is used by a recurring transaction, investment flow, or portfolio snapshot. Reassign or remove those first.",
      );
    }
  }

  const result = await prisma.account.updateMany({
    where: { id: payload.accountId, userId: user.id },
    data: { archived },
  });
  if (result.count === 0) throw new Error("Account not found.");

  if (archived) {
    await prisma.user.updateMany({
      where: { id: user.id, defaultExpenseAccountId: payload.accountId },
      data: { defaultExpenseAccountId: null },
    });
  }

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: archived ? AUDIT_ACTIONS.financial_account_archived : AUDIT_ACTIONS.financial_account_unarchived,
    targetType: "Account",
    targetId: payload.accountId,
    metadata: { archived },
    headers: h,
  });

  revalidatePath("/");
  revalidatePath("/settings");
});

