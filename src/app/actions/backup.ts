"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { TransactionType } from "@prisma/client";
import { ensureDefaultDataForUser } from "@/lib/defaults";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { userBackupSchema } from "@/lib/backup-schema";
import { assertBackupReferencesResolve, resolveBackupUserProfileFields } from "@/lib/backup-restore";
import { revokePlaidItemsForUser } from "@/lib/plaid/unlink";
import { tryMakePlaidItemRevoker } from "@/lib/plaid/service";
import {
  getFormValue,
  LONG_TRANSACTION_OPTIONS,
  formAction,
} from "./_helpers";
export const clearUserFinancialDataAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const confirmation = getFormValue(formData, "confirmation").trim();
  if (confirmation !== "RESET FINANCIAL DATA") {
    throw new Error('Type RESET FINANCIAL DATA exactly to confirm.');
  }

  // A reset drops the Plaid rows along with everything else, so the connections have to be
  // revoked at Plaid first or they outlive the data they were feeding.
  await revokePlaidItemsForUser(prisma, user.id, await tryMakePlaidItemRevoker());

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: null },
    });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.portfolioSnapshot.deleteMany({ where: { userId: user.id } });
    // Plaid rows reference Transaction and Account, so they go before both. Staged rows and
    // items are dropped outright rather than kept: a bank connection is not financial
    // history, and leaving stale cursors behind would make a later re-link re-propose
    // transactions against records that no longer exist.
    await tx.plaidStagedTransaction.deleteMany({ where: { userId: user.id } });
    await tx.transactionVerification.deleteMany({ where: { userId: user.id } });
    await tx.plaidAccount.deleteMany({ where: { userId: user.id } });
    await tx.plaidItem.deleteMany({ where: { userId: user.id } });
    await tx.transaction.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.category.deleteMany({ where: { userId: user.id } });
  });

  const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  await ensureDefaultDataForUser(freshUser);

  revalidatePath("/");
  revalidatePath("/settings");
});

export const importUserBackupAction = formAction(async (formData: FormData) => {
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
  // Everything that can reject the file runs before the banks are revoked below: revoking
  // cannot be undone, so a bad file must be refused while the connections are still live.
  assertBackupReferencesResolve(parsed);

  // Import is wipe-and-replace, and the wipe drops the Plaid rows. Backups never carry bank
  // connections, so nothing brings them back — revoke them at Plaid first, or they keep
  // billing with no local record left to revoke them by. Refuses the import if any fails.
  const { rowIds: revokedItemIds } = await revokePlaidItemsForUser(
    prisma,
    user.id,
    await tryMakePlaidItemRevoker(),
  );

  await prisma.$transaction(async (tx) => {
    // A bank linked while the revocations above were in flight was never revoked, and the
    // deletes below would orphan it. Refuse rather than delete it.
    const linkedSinceRevoke = await tx.plaidItem.count({
      where: { userId: user.id, id: { notIn: revokedItemIds } },
    });
    if (linkedSinceRevoke > 0) {
      throw new Error("A bank was connected while the backup was importing. Nothing was imported; try again.");
    }
    await tx.user.update({
      where: { id: user.id },
      data: { defaultExpenseAccountId: null },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.portfolioSnapshot.deleteMany({ where: { userId: user.id } });
    // Plaid rows reference Transaction and Account, so they go before both. Staged rows and
    // items are dropped outright rather than kept: a bank connection is not financial
    // history, and leaving stale cursors behind would make a later re-link re-propose
    // transactions against records that no longer exist.
    await tx.plaidStagedTransaction.deleteMany({ where: { userId: user.id } });
    await tx.transactionVerification.deleteMany({ where: { userId: user.id } });
    await tx.plaidAccount.deleteMany({ where: { userId: user.id } });
    await tx.plaidItem.deleteMany({ where: { userId: user.id } });
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

    // Rules go in before transactions so posted occurrences can point back at them.
    const recurringIdMap = new Map<string, string>();
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
      if (row.id) recurringIdMap.set(row.id, createdRule.id);

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

    for (const row of parsed.transactions) {
      const mappedCategoryId = categoryIdMap.get(row.categoryId);
      if (!mappedCategoryId) {
        throw new Error("Backup references unknown transaction category.");
      }
      const mappedAccountId = row.accountId ? accountIdMap.get(row.accountId) : null;
      if (row.accountId && !mappedAccountId) {
        throw new Error("Backup references unknown transaction account.");
      }
      // Files from before links were exported carry no rule ids; anything newer must
      // resolve, or posted-occurrence detection and share credits silently break later.
      const mappedRecurringId = row.recurringTransactionId ? recurringIdMap.get(row.recurringTransactionId) : null;
      if (row.recurringTransactionId && !mappedRecurringId) {
        throw new Error("Backup references unknown recurring transaction.");
      }
      // Split parts are nested rather than written in a second pass: it removes a
      // round trip per part. (The id map below exists for verifications, which are keyed
      // by the exported transaction id and written after every row is in.)
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

      const createdTransaction = await tx.transaction.create({
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
          recurringTransactionId: mappedRecurringId ?? null,
          recurringExpectedDate: mappedRecurringId && row.recurringExpectedDate ? new Date(row.recurringExpectedDate) : null,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          ...(splitParts.length > 0 ? { splitParts: { create: splitParts } } : {}),
        },
        select: { id: true },
      });
      transactionIdMap.set(row.id, createdTransaction.id);
    }

    // Verification rows carry no Plaid identifiers — the export strips them, because a
    // Plaid transaction id belongs to the Plaid client of whichever deployment produced
    // it. A restored badge therefore says the transaction was confirmed against a bank
    // without claiming a live connection, which is exactly what is true.
    for (const row of parsed.transactionVerifications ?? []) {
      const mappedTransactionId = transactionIdMap.get(row.transactionId);
      if (!mappedTransactionId) {
        throw new Error("Backup references unknown verified transaction.");
      }
      await tx.transactionVerification.create({
        data: {
          userId: user.id,
          transactionId: mappedTransactionId,
          source: row.source,
          institutionName: row.institutionName,
          verifiedAt: new Date(row.verifiedAt),
          removedByPlaidAt: row.removedByPlaidAt ? new Date(row.removedByPlaidAt) : null,
        },
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

    // `parsed.authAccounts` is deliberately not restored, and the user's existing links are
    // left untouched. Attaching an SSO identity to an account requires a fresh passkey
    // assertion (`beginSsoLinkAction`); writing provider ids straight from an uploaded file
    // would let a plain session bypass that, and would also silently drop links made
    // since the backup was taken. Relink from Settings → Security instead.

    // `parsed.passwordResetTokens` is deliberately not restored. A reset token is
    // ephemeral state, not user data, and writing hashes and expiries straight from an
    // uploaded file lets a crafted backup plant a token the author already knows the raw
    // value of — an account-takeover primitive that survives password changes. Exports
    // have always sanitised the array to empty, so nothing real is lost.
  }, LONG_TRANSACTION_OPTIONS);

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
});

