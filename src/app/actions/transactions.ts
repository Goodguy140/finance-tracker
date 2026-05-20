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

export async function createExpenseAction(formData: FormData) {
  const user = await requireUser();
  const payload = expenseBaseSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const amounts = parseExpenseAmountFromForm(formData);
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type: TransactionType.EXPENSE,
      amountCents: amounts.amountCents,
      preCreditCents: amounts.preCreditCents,
      creditCents: amounts.creditCents,
      creditBreakdownJson: amounts.creditBreakdownJson,
      date: dateFromYmd(payload.date),
      postedDate: payload.postedDate ? dateFromYmd(payload.postedDate) : null,
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function updateExpenseAction(formData: FormData) {
  const user = await requireUser();
  const payload = updateExpenseBaseSchema.parse({
    transactionId: getFormValue(formData, "transactionId"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const amounts = parseExpenseAmountFromForm(formData);
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  const existing = await prisma.transaction.findFirst({
    where: {
      id: payload.transactionId,
      userId: user.id,
      type: TransactionType.EXPENSE,
    },
    include: { splitParts: true },
  });
  if (!existing) throw new Error("Expense not found.");
  if (existing.splitParts.length > 0) {
    throw new Error("Split expenses cannot be edited here.");
  }

  await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      account: payload.accountId
        ? { connect: { id: payload.accountId } }
        : { disconnect: true },
      category: { connect: { id: payload.categoryId } },
      amountCents: amounts.amountCents,
      preCreditCents: amounts.preCreditCents,
      creditCents: amounts.creditCents,
      creditBreakdownJson: amounts.creditBreakdownJson,
      date: dateFromYmd(payload.date),
      postedDate: payload.postedDate ? dateFromYmd(payload.postedDate) : null,
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function deleteExpenseTransactionAction(formData: FormData) {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const existing = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId: user.id,
      type: TransactionType.EXPENSE,
    },
  });
  if (!existing) throw new Error("Expense not found.");

  await prisma.transaction.delete({ where: { id: existing.id } });
  revalidatePath("/");
}

export async function importExpensesCsvAction(formData: FormData) {
  const user = await requireUser();
  const rowsJson = getFormValue(formData, "rowsJson");
  const fieldSelectionsJson = getFormValue(formData, "fieldSelections");
  const parsedRows = JSON.parse(rowsJson || "[]");
  const fieldSelections = JSON.parse(fieldSelectionsJson || "[]");
  const payload = expenseCsvImportSchema.parse({
    rows: parsedRows,
    mapping: {
      amount: getFormValue(formData, "map_amount"),
      date: getFormValue(formData, "map_date") || undefined,
      postedDate: getFormValue(formData, "map_postedDate") || undefined,
      title: getFormValue(formData, "map_title") || undefined,
      note: getFormValue(formData, "map_note") || undefined,
      accountName: getFormValue(formData, "map_accountName") || undefined,
      categoryName: getFormValue(formData, "map_categoryName") || undefined,
    },
    manualValues: {
      date: getFormValue(formData, "manual_date") || undefined,
      postedDate: getFormValue(formData, "manual_postedDate") || undefined,
      title: getFormValue(formData, "manual_title") || undefined,
      note: getFormValue(formData, "manual_note") || undefined,
      accountName: getFormValue(formData, "manual_accountName") || undefined,
      categoryName: getFormValue(formData, "manual_categoryName") || undefined,
    },
    defaults: {
      accountId: getFormValue(formData, "defaultAccountId"),
      categoryId: getFormValue(formData, "defaultCategoryId"),
    },
    fieldSelections,
  });
  await Promise.all([
    payload.defaults.accountId
      ? assertUserOwnsAccount(user.id, payload.defaults.accountId)
      : Promise.resolve(),
    payload.defaults.categoryId
      ? assertUserOwnsCategory(user.id, payload.defaults.categoryId, CategoryKind.EXPENSE)
      : Promise.resolve(),
  ]);

  const usedFields = payload.fieldSelections.filter((field) => field);
  const uniqueFields = new Set(usedFields);
  if (uniqueFields.size !== usedFields.length) {
    throw new Error("Each CSV column can only be mapped to one field.");
  }

  const accounts = await prisma.account.findMany({
    where: { userId: user.id, archived: false },
    select: { id: true, name: true },
  });
  const accountByName = new Map(accounts.map((account) => [account.name.trim().toLowerCase(), account.id]));
  const categories = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    select: { id: true, name: true },
  });
  const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));

  await prisma.$transaction(async (tx) => {
    for (const row of payload.rows) {
      const amountRaw = row[payload.mapping.amount]?.trim();
      if (!amountRaw) continue;

      const amount = parseStatementAmount(amountRaw);
      if (amount === null) continue;

      const dateRaw = getOptionalMappedValue(row, payload.mapping.date) ?? payload.manualValues.date;
      const transactionDate = parseImportedDate(dateRaw) ?? new Date();

      const postedDateRaw = getOptionalMappedValue(row, payload.mapping.postedDate) ?? payload.manualValues.postedDate;
      const postedDate = parseImportedDate(postedDateRaw);
      const title = getOptionalMappedValue(row, payload.mapping.title) ?? payload.manualValues.title;
      const note = getOptionalMappedValue(row, payload.mapping.note) ?? payload.manualValues.note;

      const accountName = getOptionalMappedValue(row, payload.mapping.accountName) ?? payload.manualValues.accountName;
      const resolvedAccountId = accountName
        ? accountByName.get(accountName.toLowerCase()) ?? payload.defaults.accountId
        : payload.defaults.accountId;

      const categoryName = getOptionalMappedValue(row, payload.mapping.categoryName) ?? payload.manualValues.categoryName;
      let resolvedCategoryId = payload.defaults.categoryId;
      if (categoryName) {
        const normalizedCategoryName = categoryName.toLowerCase();
        const existingCategoryId = categoryByName.get(normalizedCategoryName);
        if (existingCategoryId) {
          resolvedCategoryId = existingCategoryId;
        } else {
          const createdCategory = await tx.category.create({
            data: {
              userId: user.id,
              kind: CategoryKind.EXPENSE,
              name: categoryName,
            },
            select: { id: true },
          });
          resolvedCategoryId = createdCategory.id;
          categoryByName.set(normalizedCategoryName, createdCategory.id);
        }
      }

      await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: resolvedAccountId,
          categoryId: resolvedCategoryId,
          type: TransactionType.EXPENSE,
          amountCents: toCents(amount),
          date: transactionDate,
          postedDate,
          title,
          note,
        },
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function createIncomeAction(formData: FormData) {
  const user = await requireUser();
  const payload = incomeSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type: TransactionType.INCOME,
      amountCents: toCents(payload.amount),
      date: dateFromYmd(payload.date),
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function updateIncomeAction(formData: FormData) {
  const user = await requireUser();
  const payload = updateIncomeBaseSchema.parse({
    transactionId: getFormValue(formData, "transactionId"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const amountRaw = getFormValue(formData, "amount");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  const existing = await prisma.transaction.findFirst({
    where: {
      id: payload.transactionId,
      userId: user.id,
      type: TransactionType.INCOME,
    },
  });
  if (!existing) throw new Error("Income entry not found.");

  await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      account: payload.accountId
        ? { connect: { id: payload.accountId } }
        : { disconnect: true },
      category: { connect: { id: payload.categoryId } },
      amountCents: toCents(amount),
      preCreditCents: null,
      creditCents: null,
      creditBreakdownJson: null,
      date: dateFromYmd(payload.date),
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function deleteIncomeTransactionAction(formData: FormData) {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const existing = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId: user.id,
      type: TransactionType.INCOME,
    },
  });
  if (!existing) throw new Error("Income entry not found.");

  await prisma.transaction.delete({ where: { id: existing.id } });
  revalidatePath("/");
}

export async function createSplitExpenseAction(formData: FormData) {
  const user = await requireUser();
  const partsRaw = getFormValue(formData, "parts");
  const parsedParts = JSON.parse(partsRaw || "[]");
  const payload = splitExpenseSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    date: getFormValue(formData, "date"),
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
    parts: parsedParts,
  });
  await Promise.all([
    assertUserOwnsAccount(user.id, payload.accountId),
    ...payload.parts.map((part) =>
      assertUserOwnsCategory(user.id, part.categoryId, CategoryKind.EXPENSE),
    ),
  ]);

  const totalCents = payload.parts.reduce((sum, p) => sum + toCents(p.amount), 0);
  const fallbackCategory = await prisma.category.findFirst({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    orderBy: { createdAt: "asc" },
  });
  if (!fallbackCategory) throw new Error("Missing expense category.");

  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: fallbackCategory.id,
      type: TransactionType.EXPENSE,
      amountCents: totalCents,
      date: dateFromYmd(payload.date),
      title: payload.title,
      note: payload.note || "Split expense",
      splitParts: {
        create: payload.parts.map((part) => ({
          userId: user.id,
          categoryId: part.categoryId,
          amountCents: toCents(part.amount),
        })),
      },
    },
  });
  revalidatePath("/");
}

