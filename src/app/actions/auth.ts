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
  updateProfileSchema,
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
  await enforceSlidingWindowRateLimit(
    `signup:${payload.email.toLowerCase()}`,
    5,
    15 * 60 * 1000,
    "Too many signup attempts. Please try again later.",
  );

  const existing = await prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } });
  if (existing) throw new Error("An account with this email already exists.");

  const count = await prisma.user.count();
  const email = payload.email.toLowerCase();
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(payload.password, 12),
      displayName: payload.displayName,
      countryCode: payload.countryCode,
      timezone: payload.timezone,
      role: resolveSignupRole(email, count),
    },
  });

  await ensureDefaultDataForUser(user);
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
    data: {
      passwordHash: await hash(payload.newPassword, 12),
      // Revoke every session issued before this change — including the attacker's, which
      // is the whole point of changing a password you think has leaked.
      tokenVersion: { increment: 1 },
    },
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
  const payload = updateProfileSchema.parse({
    displayName: getFormValue(formData, "displayName") || user.displayName,
    countryCode: getFormValue(formData, "countryCode") || user.countryCode,
    timezone: getFormValue(formData, "timezone") || user.timezone,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: payload,
  });
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
  await enforceSlidingWindowRateLimit(
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

  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (baseUrl) {
    const resetUrl = `${baseUrl}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your Finance Tracker password",
      text: `Use this link within 30 minutes to reset your password:\n\n${resetUrl}\n`,
    });
  }
}

export async function resetPasswordAction(formData: FormData) {
  const email = getFormValue(formData, "email").toLowerCase();
  const token = getFormValue(formData, "token");
  const newPassword = getFormValue(formData, "newPassword");
  await enforceSlidingWindowRateLimit(
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
    // Burn every outstanding token, not just the one presented: the others were issued to
    // the same mailbox and stay valid for the rest of their window otherwise.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hash(newPassword, 12),
        tokenVersion: { increment: 1 },
      },
    }),
  ]);
}
