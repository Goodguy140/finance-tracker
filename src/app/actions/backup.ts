"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { TransactionType } from "@prisma/client";
import { ensureDefaultDataForUser } from "@/lib/defaults";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { userBackupSchema } from "@/lib/backup-schema";
import { resolveBackupUserProfileFields, sanitizeAuthAccountsForImport } from "@/lib/backup-restore";
import {
  getFormValue,
} from "./_helpers";
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

/**
 * A whole-account restore does not fit Prisma's default 5s interactive-transaction budget
 * once there are a few months of history, and blowing the budget rolls the entire import
 * back. Both values are generous on purpose: this runs at most a few times in an account's
 * life, and a partial restore is far worse than a slow one.
 */
const IMPORT_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 180_000 } as const;

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
      // Split parts are nested rather than written in a second pass: it removes a
      // round trip per part and makes the transaction id map unnecessary.
      const splitParts = row.splitParts.map((part) => {
        const mappedSplitCategoryId = categoryIdMap.get(part.categoryId);
        if (!mappedSplitCategoryId) {
          throw new Error("Backup references unknown split category.");
        }
        return {
          userId: user.id,
          categoryId: mappedSplitCategoryId,
          amountCents: part.amountCents,
        };
      });

      await tx.transaction.create({
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
          ...(splitParts.length > 0 ? { splitParts: { create: splitParts } } : {}),
        },
        select: { id: true },
      });
    }

    await tx.budget.createMany({
      data: parsed.budgets.map((row) => {
        const mappedCategoryId = categoryIdMap.get(row.categoryId);
        if (!mappedCategoryId) {
          throw new Error("Backup references unknown budget category.");
        }
        return {
          userId: user.id,
          categoryId: mappedCategoryId,
          name: row.name,
          periodMonth: row.periodMonth,
          limitCents: row.limitCents,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        };
      }),
    });

    for (const row of parsed.recurringTransactions) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      const mappedAccountId = accountIdMap.get(row.accountId);
      if (!mappedCategoryId || !mappedAccountId) {
        throw new Error("Backup references unknown recurring transaction account or category.");
      }
      const createdRule = await tx.recurringTransaction.create({
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
        select: { id: true },
      });

      for (const member of row.members ?? []) {
        const createdMember = await tx.subscriptionMember.create({
          data: {
            userId: user.id,
            recurringTransactionId: createdRule.id,
            name: member.name,
            shareCents: member.shareCents,
            createdAt: new Date(member.createdAt),
            updatedAt: new Date(member.updatedAt),
          },
          select: { id: true },
        });
        for (const status of member.shareStatuses ?? []) {
          await tx.subscriptionShareStatus.create({
            data: {
              userId: user.id,
              memberId: createdMember.id,
              recurringTransactionId: createdRule.id,
              expectedDate: new Date(status.expectedDate),
              billSent: status.billSent,
              paid: status.paid,
              paidAt: status.paidAt ? new Date(status.paidAt) : null,
              createdAt: new Date(status.createdAt),
              updatedAt: new Date(status.updatedAt),
            },
          });
        }
      }
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

    await tx.investmentFlow.createMany({
      data: parsed.investmentFlows.map((row) => {
        const mappedAccountId = accountIdMap.get(row.accountId);
        if (!mappedAccountId) {
          throw new Error("Backup references unknown investment account.");
        }
        return {
          userId: user.id,
          accountId: mappedAccountId,
          date: new Date(row.date),
          direction: row.direction,
          amountCents: row.amountCents,
          note: row.note,
          createdAt: new Date(row.createdAt),
        };
      }),
    });

    await tx.portfolioSnapshot.createMany({
      data: parsed.portfolioSnapshots.map((row) => {
        const mappedAccountId = accountIdMap.get(row.accountId);
        if (!mappedAccountId) {
          throw new Error("Backup references unknown snapshot account.");
        }
        return {
          userId: user.id,
          accountId: mappedAccountId,
          date: new Date(row.date),
          totalValueCents: row.totalValueCents,
          note: row.note,
          createdAt: new Date(row.createdAt),
        };
      }),
    });

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

    // `parsed.passwordResetTokens` is deliberately not restored. A reset token is
    // ephemeral state, not user data, and writing hashes and expiries straight from an
    // uploaded file lets a crafted backup plant a token the author already knows the raw
    // value of — an account-takeover primitive that survives password changes. Exports
    // have always sanitised the array to empty, so nothing real is lost.
  }, IMPORT_TRANSACTION_OPTIONS);

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

