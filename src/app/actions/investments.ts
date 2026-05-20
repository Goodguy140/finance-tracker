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

