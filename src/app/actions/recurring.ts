"use server";

import { hash, compare } from "bcryptjs";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AccountType, CategoryKind, Prisma, TransactionType, UserRole } from "@prisma/client";
import { getDefaultTimezone } from "@/lib/country-config";
import { ensureDefaultDataForUser } from "@/lib/defaults";
import { parseStatementAmount, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { parseImportedDate } from "@/lib/import-dates";
import { decryptSecret, encryptSecret } from "@/lib/security";
import { requireAdmin, requireUser } from "@/lib/session";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { resolveAuthentikOauthSettings, resolveGoogleOauthSettings } from "@/lib/oauth-settings";
import { formatAccountDetachedLabel } from "@/lib/account-type-labels";
import { parseExpenseAmountFromForm } from "@/lib/expense-amount";
import { advanceRecurringDate } from "@/lib/recurring-transactions";
import { mergeAccountDescriptionOnDetach } from "@/lib/transaction-account-detach";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { userBackupSchema } from "@/lib/backup-schema";
import { resolveBackupUserProfileFields, sanitizeAuthAccountsForImport } from "@/lib/backup-restore";
import {
  budgetSchema,
  accountSchema,
  expenseCsvImportSchema,
  expenseBaseSchema,
  incomeSchema,
  updateIncomeBaseSchema,
  updateExpenseBaseSchema,
  investmentFlowSchema,
  loginSchema,
  passwordChangeSchema,
  portfolioSnapshotSchema,
  postRecurringTransactionSchema,
  recurringTransactionSchema,
  signupSchema,
  splitExpenseSchema,
  deleteBudgetSchema,
  deleteRecurringTransactionSchema,
  setRecurringTransactionEnabledSchema,
  setAccountArchivedSchema,
  updateAccountSchema,
  updateBudgetSchema,
  updateDefaultExpenseAccountSchema,
  updateRecurringTransactionSchema,
} from "@/lib/validation";
import {
  getFormValue,
  toPeriodMonth,
  getOptionalMappedValue,
  publicSignupAllowed,
  resolveSignupRole,
  assertUserOwnsAccount,
  assertUserOwnsActiveAccount,
  assertUserOwnsCategory,
  categoryKindForTransactionType,
} from "./_helpers";

export async function createRecurringTransactionAction(formData: FormData) {
  const user = await requireUser();
  const payload = recurringTransactionSchema.parse({
    type: getFormValue(formData, "type"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
  });
  const type = payload.type as TransactionType;
  await Promise.all([
    assertUserOwnsActiveAccount(user.id, payload.accountId),
    assertUserOwnsCategory(user.id, payload.categoryId, categoryKindForTransactionType(type)),
  ]);
  const nextExpectedDate = dateFromYmd(payload.nextExpectedDate);
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type,
      name: payload.name,
      amountCents: toCents(payload.amount),
      cadence: payload.cadence,
      nextExpectedDate,
      endDate,
      note: payload.note || null,
    },
  });
  revalidatePath("/");
}

export async function updateRecurringTransactionAction(formData: FormData) {
  const user = await requireUser();
  const parsed = updateRecurringTransactionSchema.safeParse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    type: getFormValue(formData, "type"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
  });
  if (!parsed.success) {
    throw new Error("Recurring transaction name, amount, cadence, account, category, and next date are required.");
  }
  const payload = parsed.data;
  const type = payload.type as TransactionType;
  await Promise.all([
    assertUserOwnsActiveAccount(user.id, payload.accountId),
    assertUserOwnsCategory(user.id, payload.categoryId, categoryKindForTransactionType(type)),
  ]);
  const nextExpectedDate = dateFromYmd(payload.nextExpectedDate);
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.update({
    where: { id: existing.id },
    data: {
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type,
      name: payload.name.trim(),
      amountCents: toCents(payload.amount),
      cadence: payload.cadence,
      nextExpectedDate,
      endDate,
      note: payload.note || null,
    },
  });
  revalidatePath("/");
}

export async function setRecurringTransactionEnabledAction(formData: FormData) {
  const user = await requireUser();
  const payload = setRecurringTransactionEnabledSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    enabled: getFormValue(formData, "enabled"),
  });

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.update({
    where: { id: existing.id },
    data: { enabled: payload.enabled === "true" },
  });
  revalidatePath("/");
}

export async function deleteRecurringTransactionAction(formData: FormData) {
  const user = await requireUser();
  const payload = deleteRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
  });

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.delete({ where: { id: existing.id } });
  revalidatePath("/");
}

export async function postRecurringTransactionAction(formData: FormData) {
  const user = await requireUser();
  const payload = postRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    expectedDate: getFormValue(formData, "expectedDate"),
  });
  const expectedDate = dateFromYmd(payload.expectedDate);

  try {
    await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringTransaction.findFirst({
        where: { id: payload.recurringTransactionId, userId: user.id },
        include: { account: true, category: true },
      });
      if (!rule) throw new Error("Recurring transaction not found.");

      if (ymdFromDateUtc(rule.nextExpectedDate) !== payload.expectedDate) {
        const posted = await tx.transaction.findFirst({
          where: {
            userId: user.id,
            recurringTransactionId: rule.id,
            recurringExpectedDate: expectedDate,
          },
          select: { id: true },
        });
        if (posted) return;
        throw new Error("This recurring transaction has already moved to a different expected date.");
      }
      if (!rule.enabled) throw new Error("Recurring transaction is disabled.");
      if (rule.account.archived) throw new Error("Cannot post a recurring transaction to an archived account.");
      if (rule.category.kind !== categoryKindForTransactionType(rule.type)) {
        throw new Error("Recurring transaction category does not match its income/expense type.");
      }
      if (rule.endDate && ymdFromDateUtc(expectedDate) > ymdFromDateUtc(rule.endDate)) {
        throw new Error("Recurring transaction has passed its end date.");
      }

      const nextExpectedDate = advanceRecurringDate(rule.nextExpectedDate, rule.cadence);
      const stillEnabled = !rule.endDate || ymdFromDateUtc(nextExpectedDate) <= ymdFromDateUtc(rule.endDate);
      const updated = await tx.recurringTransaction.updateMany({
        where: {
          id: rule.id,
          userId: user.id,
          enabled: true,
          nextExpectedDate: rule.nextExpectedDate,
        },
        data: {
          nextExpectedDate,
          enabled: stillEnabled,
        },
      });
      if (updated.count === 0) return;

      await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          type: rule.type,
          amountCents: rule.amountCents,
          title: rule.name,
          date: expectedDate,
          note: rule.note,
          recurringTransactionId: rule.id,
          recurringExpectedDate: expectedDate,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

  revalidatePath("/");
}

