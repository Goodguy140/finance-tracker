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
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { computeReallocationPlan } from "@/lib/budget-reallocation";
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
  reallocateBudgetSchema,
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

/**
 * Cover a category's current-month overage by pulling from other budgets: raise
 * the over-budget category's limit and lower each source's, all for the current
 * month (upserting current-month rows so history is untouched and the change
 * carries forward).
 */
export async function reallocateBudgetAction(formData: FormData) {
  const user = await requireUser();

  let transfers: unknown;
  try {
    transfers = JSON.parse(getFormValue(formData, "transfers") || "[]");
  } catch {
    throw new Error("Invalid reallocation request.");
  }

  const parsed = reallocateBudgetSchema.safeParse({
    destinationCategoryId: getFormValue(formData, "destinationCategoryId"),
    transfers,
  });
  if (!parsed.success) {
    throw new Error("Choose at least one budget and a positive amount to transfer.");
  }
  const payload = parsed.data;

  // Period is derived server-side; the client cannot reallocate a past month.
  const periodMonth = toPeriodMonth();
  const progress = await buildMonthlyBudgetProgress(user.id, periodMonth);

  const updates = computeReallocationPlan(
    progress.budgets,
    payload.destinationCategoryId,
    payload.transfers,
  );

  // Preserve any carried-forward label when creating a fresh current-month row.
  const affectedCategoryIds = updates.map((update) => update.categoryId);
  const priorBudgets = await prisma.budget.findMany({
    where: {
      userId: user.id,
      categoryId: { in: affectedCategoryIds },
      periodMonth: { lte: periodMonth },
    },
    orderBy: { periodMonth: "desc" },
    select: { categoryId: true, name: true },
  });
  const nameByCategory = new Map<string, string | null>();
  for (const budget of priorBudgets) {
    if (!nameByCategory.has(budget.categoryId)) nameByCategory.set(budget.categoryId, budget.name);
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.budget.upsert({
        where: {
          userId_categoryId_periodMonth: {
            userId: user.id,
            categoryId: update.categoryId,
            periodMonth,
          },
        },
        update: { limitCents: update.newLimitCents },
        create: {
          userId: user.id,
          categoryId: update.categoryId,
          periodMonth,
          limitCents: update.newLimitCents,
          name: nameByCategory.get(update.categoryId) ?? null,
        },
      }),
    ),
  );

  revalidatePath("/");
  revalidatePath("/settings");
}

