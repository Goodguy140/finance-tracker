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
