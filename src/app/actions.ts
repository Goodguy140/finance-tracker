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
import { userBackupSchema } from "@/lib/backup-schema";
import {
  resolveBackupUserProfileFields,
  sanitizeAuthAccountsForImport,
} from "@/lib/backup-restore";
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

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function toPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getOptionalMappedValue(row: Record<string, string>, key?: string) {
  if (!key) return undefined;
  return row[key]?.trim() || undefined;
}

function publicSignupAllowed() {
  const value = process.env.ALLOW_PUBLIC_SIGNUP?.trim().toLowerCase();
  if (value === undefined) {
    return process.env.NODE_ENV !== "production";
  }
  return value === "true" || value === "1";
}

async function assertUserOwnsAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Selected account was not found.");
  }
}

async function assertUserOwnsActiveAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, archived: false },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Selected account was not found or is archived.");
  }
}

async function assertUserOwnsCategory(userId: string, categoryId: string, kind?: CategoryKind) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId, ...(kind ? { kind } : {}) },
    select: { id: true },
  });
  if (!category) {
    throw new Error("Selected category was not found.");
  }
}

function categoryKindForTransactionType(type: TransactionType): CategoryKind {
  return type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE;
}

export async function signupAction(formData: FormData) {
  const payload = signupSchema.parse({
    email: getFormValue(formData, "email"),
    password: getFormValue(formData, "password"),
    displayName: getFormValue(formData, "displayName"),
    countryCode: getFormValue(formData, "countryCode") || "CA",
    timezone:
      getFormValue(formData, "timezone") ||
      getDefaultTimezone(getFormValue(formData, "countryCode") || "CA"),
  });
  if (!publicSignupAllowed()) {
    throw new Error("Public sign up is disabled.");
  }
  enforceSlidingWindowRateLimit(
    `signup:${payload.email.toLowerCase()}`,
    5,
    15 * 60 * 1000,
    "Too many signup attempts. Please try again later.",
  );

  const existing = await prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } });
  if (existing) throw new Error("An account with this email already exists.");

  const count = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      email: payload.email.toLowerCase(),
      passwordHash: await hash(payload.password, 12),
      displayName: payload.displayName,
      countryCode: payload.countryCode,
      timezone: payload.timezone,
      role: count === 0 ? UserRole.SERVER_ADMIN : UserRole.USER,
    },
  });

  await ensureDefaultDataForUser(user);
  revalidatePath("/");
}

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

export async function upsertBudgetAction(formData: FormData) {
  const user = await requireUser();
  const rawPeriodMonth = getFormValue(formData, "periodMonth");
  const parsed = budgetSchema.safeParse({
    categoryName: getFormValue(formData, "categoryName"),
    limit: getFormValue(formData, "limit"),
    periodMonth: rawPeriodMonth || undefined,
  });
  if (!parsed.success) {
    throw new Error("Category name and budget limit are required.");
  }
  const payload = parsed.data;
  const currentPeriodMonth = toPeriodMonth();
  const periodMonth = payload.periodMonth ?? currentPeriodMonth;

  if (payload.periodMonth && payload.periodMonth >= currentPeriodMonth) {
    throw new Error("Month can only be set for previous months. Current and future months update automatically.");
  }
  const normalizedCategoryName = payload.categoryName.trim();
  const expenseCategories = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    select: { id: true, name: true },
  });
  const existingCategory = expenseCategories.find(
    (category) => category.name.toLowerCase() === normalizedCategoryName.toLowerCase(),
  );
  const categoryId = existingCategory
    ? existingCategory.id
    : (
        await prisma.category.create({
          data: {
            userId: user.id,
            name: normalizedCategoryName,
            kind: CategoryKind.EXPENSE,
          },
        })
      ).id;

  await prisma.budget.upsert({
    where: {
      userId_categoryId_periodMonth: {
        userId: user.id,
        categoryId,
        periodMonth,
      },
    },
    update: {
      limitCents: toCents(payload.limit),
    },
    create: {
      userId: user.id,
      categoryId,
      periodMonth,
      limitCents: toCents(payload.limit),
    },
  });
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function updateBudgetAction(formData: FormData) {
  const user = await requireUser();
  const parsed = updateBudgetSchema.safeParse({
    budgetId: getFormValue(formData, "budgetId"),
    name: getFormValue(formData, "name"),
    limit: getFormValue(formData, "limit"),
  });
  if (!parsed.success) {
    throw new Error("Budget name and limit are required.");
  }
  const payload = parsed.data;

  const existing = await prisma.budget.findFirst({
    where: { id: payload.budgetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Budget not found.");

  await prisma.budget.update({
    where: { id: existing.id },
    data: {
      name: payload.name.trim(),
      limitCents: toCents(payload.limit),
    },
  });
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function deleteBudgetAction(formData: FormData) {
  const user = await requireUser();
  const payload = deleteBudgetSchema.parse({
    budgetId: getFormValue(formData, "budgetId"),
  });

  const existing = await prisma.budget.findFirst({
    where: { id: payload.budgetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Budget not found.");

  await prisma.budget.delete({
    where: { id: existing.id },
  });
  revalidatePath("/");
  revalidatePath("/settings");
}

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

export async function createInvestmentFlowAction(formData: FormData) {
  const user = await requireUser();
  const payload = investmentFlowSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    direction: getFormValue(formData, "direction"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  await assertUserOwnsAccount(user.id, payload.accountId);

  await prisma.investmentFlow.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      direction: payload.direction,
      amountCents: toCents(payload.amount),
      date: dateFromYmd(payload.date),
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function createPortfolioSnapshotAction(formData: FormData) {
  const user = await requireUser();
  const payload = portfolioSnapshotSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    totalValue: getFormValue(formData, "totalValue"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  await assertUserOwnsAccount(user.id, payload.accountId);

  await prisma.portfolioSnapshot.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      totalValueCents: toCents(payload.totalValue),
      date: dateFromYmd(payload.date),
      note: payload.note,
    },
  });
  revalidatePath("/");
}

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const payload = passwordChangeSchema.parse({
    currentPassword: getFormValue(formData, "currentPassword"),
    newPassword: getFormValue(formData, "newPassword"),
    confirmPassword: getFormValue(formData, "confirmPassword"),
  });

  if (!user.passwordHash) throw new Error("Password login is not enabled for this account.");
  const valid = await compare(payload.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(payload.newPassword, 12) },
  });
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_password_changed,
    headers: h,
  });
}

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      displayName: getFormValue(formData, "displayName") || user.displayName,
      countryCode: getFormValue(formData, "countryCode") || user.countryCode,
      timezone: getFormValue(formData, "timezone") || user.timezone,
    },
  });
  revalidatePath("/settings");
}

export async function createFinancialAccountAction(formData: FormData) {
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
}

export async function updateFinancialAccountAction(formData: FormData) {
  const user = await requireUser();
  const payload = updateAccountSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    name: getFormValue(formData, "name"),
    type: getFormValue(formData, "type"),
    currency: getFormValue(formData, "currency"),
  });

  const result = await prisma.account.updateMany({
    where: { id: payload.accountId, userId: user.id },
    data: {
      name: payload.name,
      type: payload.type as AccountType,
      currency: payload.currency,
    },
  });
  if (result.count === 0) throw new Error("Account not found.");

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function updateDefaultExpenseAccountAction(formData: FormData) {
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
}

export async function deleteFinancialAccountAction(formData: FormData) {
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
}

export async function setFinancialAccountArchivedAction(formData: FormData) {
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
}

export async function clearUserFinancialDataAction(formData: FormData) {
  const user = await requireUser();
  const confirmation = getFormValue(formData, "confirmation").trim();
  if (confirmation !== "RESET FINANCIAL DATA") {
    throw new Error('Type RESET FINANCIAL DATA exactly to confirm.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: null },
    });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.portfolioSnapshot.deleteMany({ where: { userId: user.id } });
    await tx.transaction.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.category.deleteMany({ where: { userId: user.id } });
  });

  const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  await ensureDefaultDataForUser(freshUser);

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function importUserBackupAction(formData: FormData) {
  const user = await requireUser();
  const raw = formData.get("backupJson");
  if (!(raw instanceof File)) {
    throw new Error("Backup file is required.");
  }
  const content = await raw.text();
  if (!content.trim()) {
    throw new Error("Backup file is empty.");
  }

  const parsed = userBackupSchema.parse(JSON.parse(content));
  if (parsed.user.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("Backup email does not match the current account.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: null },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.authAccount.deleteMany({ where: { userId: user.id } });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.portfolioSnapshot.deleteMany({ where: { userId: user.id } });
    await tx.transaction.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.category.deleteMany({ where: { userId: user.id } });

    const accountIdMap = new Map<string, string>();
    const categoryIdMap = new Map<string, string>();
    const transactionIdMap = new Map<string, string>();

    const profileFields = resolveBackupUserProfileFields({
      currentUser: { role: user.role, passwordHash: user.passwordHash },
      parsedUser: parsed.user,
    });
    await tx.user.update({
      where: { id: user.id },
      data: profileFields,
    });

    for (const account of parsed.accounts) {
      const created = await tx.account.create({
        data: {
          userId: user.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          countryCode: account.countryCode,
          provider: account.provider,
          archived: account.archived,
          createdAt: new Date(account.createdAt),
          updatedAt: new Date(account.updatedAt),
        },
        select: { id: true },
      });
      accountIdMap.set(account.id, created.id);
    }

    let restoredDefaultExpenseAccountId: string | null = null;
    const backupDefaultId = parsed.user.defaultExpenseAccountId;
    if (backupDefaultId) {
      const backed = parsed.accounts.find((a) => a.id === backupDefaultId);
      if (backed && !backed.archived) {
        restoredDefaultExpenseAccountId = accountIdMap.get(backupDefaultId) ?? null;
      }
    }
    await tx.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: restoredDefaultExpenseAccountId },
    });

    for (const category of parsed.categories) {
      const created = await tx.category.create({
        data: {
          userId: user.id,
          name: category.name,
          kind: category.kind,
          isDefault: category.isDefault,
          createdAt: new Date(category.createdAt),
          updatedAt: new Date(category.updatedAt),
        },
        select: { id: true },
      });
      categoryIdMap.set(category.id, created.id);
    }

    for (const row of parsed.transactions) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      if (!mappedCategoryId) {
        throw new Error("Backup references unknown transaction category.");
      }
      const mappedAccountId = row.accountId ? accountIdMap.get(row.accountId) : null;
      if (row.accountId && !mappedAccountId) {
        throw new Error("Backup references unknown transaction account.");
      }
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: mappedAccountId ?? null,
          categoryId: mappedCategoryId,
          type: row.type,
          amountCents: row.amountCents,
          preCreditCents: row.preCreditCents,
          creditCents: row.creditCents,
          creditBreakdownJson: row.creditBreakdownJson,
          title: row.title,
          date: new Date(row.date),
          postedDate: row.postedDate ? new Date(row.postedDate) : null,
          accountDescription: row.accountDescription,
          note: row.note,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
        select: { id: true },
      });
      transactionIdMap.set(row.id, created.id);
    }

    for (const row of parsed.transactions) {
      const mappedTransactionId = transactionIdMap.get(row.id);
      if (!mappedTransactionId) continue;
      for (const part of row.splitParts) {
        const mappedCategoryId = categoryIdMap.get(part.categoryId);
        if (!mappedCategoryId) {
          throw new Error("Backup references unknown split category.");
        }
        await tx.splitTransactionPart.create({
          data: {
            userId: user.id,
            transactionId: mappedTransactionId,
            categoryId: mappedCategoryId,
            amountCents: part.amountCents,
          },
        });
      }
    }

    for (const row of parsed.budgets) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      if (!mappedCategoryId) {
        throw new Error("Backup references unknown budget category.");
      }
      await tx.budget.create({
        data: {
          userId: user.id,
          categoryId: mappedCategoryId,
          name: row.name,
          periodMonth: row.periodMonth,
          limitCents: row.limitCents,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    }

    for (const row of parsed.recurringTransactions) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      const mappedAccountId = accountIdMap.get(row.accountId);
      if (!mappedCategoryId || !mappedAccountId) {
        throw new Error("Backup references unknown recurring transaction account or category.");
      }
      await tx.recurringTransaction.create({
        data: {
          userId: user.id,
          accountId: mappedAccountId,
          categoryId: mappedCategoryId,
          type: row.type,
          name: row.name,
          amountCents: row.amountCents,
          cadence: row.cadence,
          nextExpectedDate: new Date(row.nextExpectedDate),
          endDate: row.endDate ? new Date(row.endDate) : null,
          postMode: row.postMode,
          enabled: row.enabled,
          note: row.note,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    }

    for (const row of parsed.subscriptions ?? []) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      const mappedAccountId = accountIdMap.get(row.accountId);
      if (!mappedCategoryId || !mappedAccountId) {
        throw new Error("Backup references unknown legacy recurring account or category.");
      }
      await tx.recurringTransaction.create({
        data: {
          userId: user.id,
          accountId: mappedAccountId,
          categoryId: mappedCategoryId,
          type: TransactionType.EXPENSE,
          name: row.name,
          amountCents: row.amountCents,
          cadence: row.billingCycle,
          nextExpectedDate: new Date(row.nextChargeDate),
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    }

    for (const row of parsed.investmentFlows) {
      const mappedAccountId = accountIdMap.get(row.accountId);
      if (!mappedAccountId) {
        throw new Error("Backup references unknown investment account.");
      }
      await tx.investmentFlow.create({
        data: {
          userId: user.id,
          accountId: mappedAccountId,
          date: new Date(row.date),
          direction: row.direction,
          amountCents: row.amountCents,
          note: row.note,
          createdAt: new Date(row.createdAt),
        },
      });
    }

    for (const row of parsed.portfolioSnapshots) {
      const mappedAccountId = accountIdMap.get(row.accountId);
      if (!mappedAccountId) {
        throw new Error("Backup references unknown snapshot account.");
      }
      await tx.portfolioSnapshot.create({
        data: {
          userId: user.id,
          accountId: mappedAccountId,
          date: new Date(row.date),
          totalValueCents: row.totalValueCents,
          note: row.note,
          createdAt: new Date(row.createdAt),
        },
      });
    }

    for (const row of sanitizeAuthAccountsForImport(parsed.authAccounts)) {
      await tx.authAccount.create({
        data: {
          userId: user.id,
          provider: row.provider,
          providerAccountId: row.providerAccountId,
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          expiresAt: row.expiresAt,
          tokenType: row.tokenType,
          scope: row.scope,
          idToken: row.idToken,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    }

    for (const row of parsed.passwordResetTokens) {
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: row.tokenHash,
          expiresAt: new Date(row.expiresAt),
          usedAt: row.usedAt ? new Date(row.usedAt) : null,
          createdAt: new Date(row.createdAt),
        },
      });
    }
  });

  const h = await headers();
  const fileMeta =
    raw instanceof File
      ? { fileName: raw.name || "upload", sizeBytes: raw.size }
      : { fileName: "unknown", sizeBytes: 0 };
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_backup_imported,
    metadata: fileMeta,
    headers: h,
  });

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function deleteAccountAction(formData: FormData) {
  const user = await requireUser();
  const confirmation = getFormValue(formData, "confirmation");
  if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm.");
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_account_deleted,
    targetType: "User",
    targetId: user.id,
    headers: h,
  });
  await prisma.user.delete({ where: { id: user.id } });
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = loginSchema.parse({
    email: getFormValue(formData, "email"),
    password: "12345678",
  }).email;
  enforceSlidingWindowRateLimit(
    `password-reset-request:${email.toLowerCase()}`,
    5,
    15 * 60 * 1000,
    "Too many password reset attempts. Please try again later.",
  );
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return;

  const token = crypto.randomUUID();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: await hash(token, 8),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  });

  // TODO: Wire email delivery. Intentionally not logged to avoid credential leakage.
}

export async function resetPasswordAction(formData: FormData) {
  const email = getFormValue(formData, "email").toLowerCase();
  const token = getFormValue(formData, "token");
  const newPassword = getFormValue(formData, "newPassword");
  enforceSlidingWindowRateLimit(
    `password-reset:${email}`,
    10,
    15 * 60 * 1000,
    "Too many password reset attempts. Please try again later.",
  );
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Invalid email/token combination.");

  const candidateTokens = await prisma.passwordResetToken.findMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  let matched: { id: string } | null = null;
  for (const item of candidateTokens) {
    if (await compare(token, item.tokenHash)) {
      matched = { id: item.id };
      break;
    }
  }
  if (!matched) throw new Error("Invalid or expired token.");

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(newPassword, 12) },
    }),
  ]);
}

export async function updateAdminOauthSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const [googleClientIdRow, googleClientSecretRow, authentikIssuerRow, authentikClientIdRow, authentikClientSecretRow] =
    await Promise.all([
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientSecret" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.issuer" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientSecret" } }),
    ]);
  const googleResolved = resolveGoogleOauthSettings({
    enabledRaw: getFormValue(formData, "googleEnabled"),
    clientIdRaw: getFormValue(formData, "googleClientId"),
    clientSecretRaw: getFormValue(formData, "googleClientSecret"),
    existingClientId: googleClientIdRow ? decryptSecret(googleClientIdRow.encryptedValue) : "",
    existingClientSecret: googleClientSecretRow ? decryptSecret(googleClientSecretRow.encryptedValue) : "",
  });
  const authentikResolved = resolveAuthentikOauthSettings({
    enabledRaw: getFormValue(formData, "authentikEnabled"),
    issuerRaw: getFormValue(formData, "authentikIssuer"),
    clientIdRaw: getFormValue(formData, "authentikClientId"),
    clientSecretRaw: getFormValue(formData, "authentikClientSecret"),
    existingIssuer: authentikIssuerRow ? decryptSecret(authentikIssuerRow.encryptedValue) : "",
    existingClientId: authentikClientIdRow ? decryptSecret(authentikClientIdRow.encryptedValue) : "",
    existingClientSecret: authentikClientSecretRow ? decryptSecret(authentikClientSecretRow.encryptedValue) : "",
  });
  const entries = [
    { key: "oauth.google.enabled", value: googleResolved.enabled },
    { key: "oauth.google.clientId", value: googleResolved.clientId },
    { key: "oauth.google.clientSecret", value: googleResolved.clientSecret },
    { key: "oauth.authentik.enabled", value: authentikResolved.enabled },
    { key: "oauth.authentik.issuer", value: authentikResolved.issuer },
    { key: "oauth.authentik.clientId", value: authentikResolved.clientId },
    { key: "oauth.authentik.clientSecret", value: authentikResolved.clientSecret },
  ];

  for (const entry of entries) {
    await prisma.serverSetting.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key,
        encryptedValue: encryptSecret(entry.value),
        updatedByUserId: user.id,
      },
      update: {
        encryptedValue: encryptSecret(entry.value),
        updatedByUserId: user.id,
      },
    });
  }
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.admin_oauth_settings_updated,
    metadata: {
      googleEnabled: googleResolved.enabled,
      authentikEnabled: authentikResolved.enabled,
    },
    headers: h,
  });
  revalidatePath("/settings/admin");
}
