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
import { normalizeTagName, tagNameKey } from "@/lib/tags";
import { isMappablePlaidCategory } from "@/lib/plaid/category-taxonomy";
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
    await tx.transactionRule.deleteMany({ where: { userId: user.id } });
    await tx.hiddenTitleSuggestion.deleteMany({ where: { userId: user.id } });
    await tx.tag.deleteMany({ where: { userId: user.id } });
    await tx.insightDismissal.deleteMany({ where: { userId: user.id } });
    await tx.insightPreference.deleteMany({ where: { userId: user.id } });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.contributionRoom.deleteMany({ where: { userId: user.id } });
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
    await tx.transactionRule.deleteMany({ where: { userId: user.id } });
    await tx.hiddenTitleSuggestion.deleteMany({ where: { userId: user.id } });
    await tx.tag.deleteMany({ where: { userId: user.id } });
    await tx.insightDismissal.deleteMany({ where: { userId: user.id } });
    await tx.insightPreference.deleteMany({ where: { userId: user.id } });
    await tx.budget.deleteMany({ where: { userId: user.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId: user.id } });
    await tx.recurringTransaction.deleteMany({ where: { userId: user.id } });
    await tx.investmentFlow.deleteMany({ where: { userId: user.id } });
    await tx.contributionRoom.deleteMany({ where: { userId: user.id } });
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

    // Tags go in before the transactions and rules that carry them. Names are matched the
    // way the app matches them, so a hand-edited file with "Trip" and "trip" makes one tag.
    const tagIdMap = new Map<string, string>();
    const tagIdByKey = new Map<string, string>();
    const mappedTagId = (id: string) => {
      const mapped = tagIdMap.get(id);
      if (!mapped) throw new Error("Backup references unknown tag.");
      return mapped;
    };
    for (const row of parsed.tags ?? []) {
      const name = normalizeTagName(row.name);
      if (!name) throw new Error("Backup has a tag with no name.");
      const nameKey = tagNameKey(name);
      let id = tagIdByKey.get(nameKey);
      if (!id) {
        const created = await tx.tag.create({
          data: { userId: user.id, name, nameKey, createdAt: new Date(row.createdAt) },
          select: { id: true },
        });
        id = created.id;
        tagIdByKey.set(nameKey, id);
      }
      tagIdMap.set(row.id, id);
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
          anchorDay: row.anchorDay ?? null,
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
      const mappedTransferAccountId = row.transferAccountId ? accountIdMap.get(row.transferAccountId) : null;
      if (row.transferAccountId && !mappedTransferAccountId) {
        throw new Error("Backup references unknown transfer account.");
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
          transferAccountId: mappedTransferAccountId ?? null,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          ...(splitParts.length > 0 ? { splitParts: { create: splitParts } } : {}),
          ...(row.owedShares.length > 0
            ? {
                owedShares: {
                  create: row.owedShares.map((share) => ({
                    userId: user.id,
                    name: share.name,
                    amountCents: share.amountCents,
                    paidAt: share.paidAt ? new Date(share.paidAt) : null,
                    createdAt: new Date(share.createdAt),
                    updatedAt: new Date(share.updatedAt),
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });
      transactionIdMap.set(row.id, createdTransaction.id);
      const mappedTagIds = new Set((row.tagIds ?? []).map(mappedTagId));
      if (mappedTagIds.size > 0) {
        await tx.transactionTag.createMany({
          data: [...mappedTagIds].map((tagId) => ({ transactionId: createdTransaction.id, tagId })),
        });
      }
    }

    // The two legs of a transfer point at each other, so neither can be written with its
    // link until both exist.
    for (const row of parsed.transactions) {
      if (!row.transferPeerId) continue;
      const mappedPeerId = transactionIdMap.get(row.transferPeerId);
      if (!mappedPeerId) {
        throw new Error("Backup references unknown transfer leg.");
      }
      await tx.transaction.update({
        where: { id: transactionIdMap.get(row.id)! },
        data: { transferPeerId: mappedPeerId },
      });
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
        const mappedTransactionId = row.transactionId ? transactionIdMap.get(row.transactionId) : undefined;
        if (row.transactionId && !mappedTransactionId) {
          throw new Error("Backup references unknown counted transfer.");
        }
        return {
          userId: user.id,
          accountId: mappedAccountId,
          date: new Date(row.date),
          direction: row.direction,
          amountCents: row.amountCents,
          note: row.note,
          transactionId: mappedTransactionId ?? null,
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

    await tx.transactionRule.createMany({
      data: (parsed.transactionRules ?? []).map((row) => {
        const mapped = (map: Map<string, string>, id: string | null) => {
          if (!id) return null;
          const next = map.get(id);
          if (!next) throw new Error("Backup references unknown rule account or category.");
          return next;
        };
        return {
          userId: user.id,
          priority: row.priority,
          enabled: row.enabled,
          titleOperator: row.titleOperator,
          titlePattern: row.titlePattern,
          transactionType: row.transactionType,
          matchAccountId: mapped(accountIdMap, row.matchAccountId),
          minAmountCents: row.minAmountCents,
          maxAmountCents: row.maxAmountCents,
          setCategoryId: mapped(categoryIdMap, row.setCategoryId),
          setTitle: row.setTitle,
          setAmountCents: row.setAmountCents,
          setAccountId: mapped(accountIdMap, row.setAccountId),
          appendNote: row.appendNote,
          addTagId: row.addTagId ? mappedTagId(row.addTagId) : null,
          createdAt: new Date(row.createdAt),
        };
      }),
    });
    const hiddenTitleKeys = new Set((parsed.hiddenTitleSuggestions ?? []).map((row) => row.titleKey));
    await tx.hiddenTitleSuggestion.createMany({
      data: [...hiddenTitleKeys].map((titleKey) => ({ userId: user.id, titleKey })),
    });
    const dismissalsByKey = new Map((parsed.insightDismissals ?? []).map((row) => [row.insightKey, row]));
    await tx.insightDismissal.createMany({
      data: [...dismissalsByKey.values()].map((row) => ({
        userId: user.id,
        insightKey: row.insightKey,
        snoozedUntil: row.snoozedUntil ? new Date(row.snoozedUntil) : null,
      })),
    });
    if (parsed.insightPreference) {
      await tx.insightPreference.create({
        data: { userId: user.id, habitDetectionEnabled: parsed.insightPreference.habitDetectionEnabled },
      });
    }
    // Last write wins on a duplicate (type, year), matching what saving it twice in the app does.
    const roomsByKey = new Map(
      (parsed.contributionRooms ?? []).map((row) => [`${row.accountType}:${row.year}`, row]),
    );
    await tx.contributionRoom.createMany({
      data: [...roomsByKey.values()].map((row) => ({
        userId: user.id,
        accountType: row.accountType,
        year: row.year,
        roomCents: row.roomCents,
      })),
    });
    // A code this version does not know (a hand-edited file, or a newer taxonomy) is dropped
    // rather than refusing the whole restore; it would never match anything here anyway.
    const mappingsByCode = new Map(
      (parsed.plaidCategoryMappings ?? [])
        .filter((row) => isMappablePlaidCategory(row.plaidCategory))
        .map((row) => [row.plaidCategory, row]),
    );
    await tx.plaidCategoryMapping.createMany({
      data: [...mappingsByCode.values()].map((row) => {
        const categoryId = categoryIdMap.get(row.categoryId);
        if (!categoryId) throw new Error("Backup references unknown category in a bank category mapping.");
        return { userId: user.id, plaidCategory: row.plaidCategory, categoryId };
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

