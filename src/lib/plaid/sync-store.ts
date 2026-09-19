import { CategoryKind, PlaidItemStatus, PlaidStagedStatus, Prisma } from "@prisma/client";
import { LONG_TRANSACTION_OPTIONS } from "@/app/actions/_helpers";
import { prisma } from "@/lib/prisma";
import { UNCATEGORIZED_NAME } from "@/lib/plaid/category-map";
import {
  assignMatches,
  MATCH_DATE_TOLERANCE_DAYS,
  type MatchCandidate,
  type StagedForMatch,
} from "@/lib/plaid/matcher";
import { openAccessToken } from "@/lib/plaid/service";
import type { ExistingStagedRow } from "@/lib/plaid/sync-plan";
import type { SyncStore } from "@/lib/plaid/sync";

/**
 * The Prisma half of the sync walk. Deliberately thin: every decision about what a page
 * *means* lives in `sync-plan.ts`, and this only applies it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finds or creates the per-user "Uncategorized" category for a kind.
 *
 * Required rather than optional: `Transaction.categoryId` is non-nullable with
 * `onDelete: Restrict`, so there is no "no category" to fall back to and a staged row
 * always needs something selected.
 */
async function ensureFallbackCategory(userId: string, kind: CategoryKind): Promise<string> {
  const existing = await prisma.category.findFirst({
    where: { userId, kind, name: UNCATEGORIZED_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.category.create({
    data: { userId, kind, name: UNCATEGORIZED_NAME },
    select: { id: true },
  });
  return created.id;
}

export function createSyncStore(): SyncStore {
  return {
    async acquireLock(itemId, staleBefore, now) {
      // A conditional update is the lock: only one caller can move `syncingSince` off
      // null (or off a stale value), so two tabs hammering "Sync now" cannot both walk.
      const claimed = await prisma.plaidItem.updateMany({
        where: {
          id: itemId,
          OR: [{ syncingSince: null }, { syncingSince: { lt: staleBefore } }],
        },
        data: { syncingSince: now },
      });
      if (claimed.count !== 1) return null;

      const item = await prisma.plaidItem.findUnique({
        where: { id: itemId },
        include: { plaidAccounts: true },
      });
      if (!item) return null;

      const [categories, fallbackExpense, fallbackIncome] = await Promise.all([
        prisma.category.findMany({
          where: { userId: item.userId },
          select: { id: true, name: true, kind: true },
        }),
        ensureFallbackCategory(item.userId, CategoryKind.EXPENSE),
        ensureFallbackCategory(item.userId, CategoryKind.INCOME),
      ]);

      return {
        id: item.id,
        userId: item.userId,
        cursor: item.cursor,
        accessToken: openAccessToken(item),
        initialSyncPending: item.initialSyncDoneAt === null,
        context: {
          historyCutoff: item.historyCutoff,
          accounts: new Map(
            item.plaidAccounts.map((account) => [
              account.plaidAccountId,
              {
                rowId: account.id,
                accountId: account.accountId,
                syncEnabled: account.syncEnabled,
              },
            ]),
          ),
          categories,
          itemDefaultCategoryId: item.defaultCategoryId,
          fallbackCategoryId: {
            [CategoryKind.EXPENSE]: fallbackExpense,
            [CategoryKind.INCOME]: fallbackIncome,
          },
        },
      };
    },

    async releaseLock(itemId) {
      await prisma.plaidItem.updateMany({ where: { id: itemId }, data: { syncingSince: null } });
    },

    async loadExistingStaged(userId, plaidTransactionIds) {
      if (plaidTransactionIds.length === 0) return [];
      const rows = await prisma.plaidStagedTransaction.findMany({
        where: { userId, plaidTransactionId: { in: plaidTransactionIds } },
        select: { plaidTransactionId: true, status: true, resolvedTransactionId: true },
      });
      return rows satisfies ExistingStagedRow[];
    },

    async loadApprovedAmounts(userId, transactionIds) {
      if (transactionIds.length === 0) return new Map();
      const rows = await prisma.transaction.findMany({
        where: { userId, id: { in: transactionIds } },
        select: { id: true, amountCents: true },
      });
      return new Map(rows.map((row) => [row.id, row.amountCents]));
    },

    async commitPage(item, plan) {
      // The page's rows and the cursor it produced go in together. A crash replays exactly
      // one page, and the unique key on (userId, plaidTransactionId) makes that a no-op.
      await prisma.$transaction(async (tx) => {
        for (const upsert of plan.upserts) {
          const shared = {
            plaidAccountRowId: upsert.plaidAccountRowId,
            pendingPlaidTransactionId: upsert.pendingPlaidTransactionId,
            isPending: upsert.isPending,
            name: upsert.name,
            merchantName: upsert.merchantName,
            amountCents: upsert.amountCents,
            type: upsert.type,
            currency: upsert.currency,
            date: upsert.date,
            postedDate: upsert.postedDate,
            pfcPrimary: upsert.pfcPrimary,
            pfcDetailed: upsert.pfcDetailed,
            suggestedCategoryId: upsert.suggestedCategoryId,
            suggestedAccountId: upsert.suggestedAccountId,
          };
          await tx.plaidStagedTransaction.upsert({
            where: {
              userId_plaidTransactionId: {
                userId: item.userId,
                plaidTransactionId: upsert.plaidTransactionId,
              },
            },
            create: {
              userId: item.userId,
              plaidItemId: item.id,
              plaidTransactionId: upsert.plaidTransactionId,
              status: upsert.status ?? PlaidStagedStatus.NEEDS_REVIEW,
              ...shared,
            },
            // A status is only forced when a decision is being inherited; otherwise the
            // user's own decision on this row must survive an update.
            update: { ...shared, ...(upsert.status ? { status: upsert.status } : {}) },
          });
        }

        if (plan.supersede.length > 0) {
          await tx.plaidStagedTransaction.updateMany({
            where: { userId: item.userId, plaidTransactionId: { in: plan.supersede } },
            data: { status: PlaidStagedStatus.SUPERSEDED },
          });
        }

        for (const transfer of plan.transfers) {
          // The bank record backing this transaction changed id when it posted. Move the
          // verification rather than creating a second one — a transaction has at most one.
          await tx.transactionVerification.updateMany({
            where: { userId: item.userId, transactionId: transfer.transactionId },
            data: { plaidTransactionId: transfer.toPlaidTransactionId },
          });
          if (transfer.postedDate) {
            await tx.transaction.updateMany({
              where: { id: transfer.transactionId, userId: item.userId, postedDate: null },
              data: { postedDate: transfer.postedDate },
            });
          }
          if (transfer.amountChanged) {
            await tx.plaidStagedTransaction.updateMany({
              where: {
                userId: item.userId,
                plaidTransactionId: transfer.toPlaidTransactionId,
              },
              data: { revisedAfterResolveAt: new Date() },
            });
          }
        }

        if (plan.markRemoved.length > 0) {
          await tx.plaidStagedTransaction.updateMany({
            where: { userId: item.userId, plaidTransactionId: { in: plan.markRemoved } },
            data: { status: PlaidStagedStatus.REMOVED_BY_PLAID },
          });
        }

        if (plan.flagRemovedOnVerification.length > 0) {
          // Never deletes the user's transaction: the badge simply says the bank later
          // withdrew the record it was confirmed against.
          await tx.transactionVerification.updateMany({
            where: {
              userId: item.userId,
              plaidTransactionId: { in: plan.flagRemovedOnVerification },
              removedByPlaidAt: null,
            },
            data: { removedByPlaidAt: new Date() },
          });
        }

        if (plan.flagRevised.length > 0) {
          await tx.plaidStagedTransaction.updateMany({
            where: { userId: item.userId, plaidTransactionId: { in: plan.flagRevised } },
            data: { revisedAfterResolveAt: new Date() },
          });
        }

        await tx.plaidItem.update({
          where: { id: item.id },
          data: { cursor: plan.nextCursor },
        });
      }, LONG_TRANSACTION_OPTIONS);
    },

    async finalize(input) {
      await prisma.plaidItem.update({
        where: { id: input.itemId },
        data: {
          lastSyncedAt: input.error ? undefined : input.now,
          lastSyncError: input.error,
          status: input.needsReauth ? PlaidItemStatus.LOGIN_REQUIRED : undefined,
          errorMessage: input.error,
          ...(input.completedInitialSync
            ? {
                initialSyncDoneAt: input.now,
                ...(input.earliestObserved ? { earliestObservedAt: input.earliestObserved } : {}),
              }
            : {}),
        },
      });
    },

    async matchPendingRows(item) {
      const staged = await prisma.plaidStagedTransaction.findMany({
        where: { userId: item.userId, plaidItemId: item.id, status: PlaidStagedStatus.NEEDS_REVIEW },
        select: {
          id: true,
          suggestedAccountId: true,
          type: true,
          amountCents: true,
          date: true,
          postedDate: true,
          name: true,
          merchantName: true,
        },
      });
      if (staged.length === 0) return 0;

      const dates = staged.map((row) => row.date.getTime());
      const tolerance = MATCH_DATE_TOLERANCE_DAYS * DAY_MS;
      // One windowed scan for the whole batch rather than a query per row — this is the
      // query `Transaction(userId, date)` was added for.
      const candidateRows = await prisma.transaction.findMany({
        where: {
          userId: item.userId,
          date: {
            gte: new Date(Math.min(...dates) - tolerance),
            lte: new Date(Math.max(...dates) + tolerance),
          },
          verification: { is: null },
        },
        select: {
          id: true,
          accountId: true,
          type: true,
          amountCents: true,
          date: true,
          postedDate: true,
          title: true,
          splitParts: { select: { id: true }, take: 1 },
        },
      });

      const candidates: MatchCandidate[] = candidateRows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        type: row.type,
        amountCents: row.amountCents,
        date: row.date,
        postedDate: row.postedDate,
        title: row.title,
        // The query already excludes verified rows; keeping the field honest for the
        // matcher's own gate rather than relying on the caller having filtered.
        isVerified: false,
        isSplitParent: row.splitParts.length > 0,
      }));

      const forMatch: StagedForMatch[] = staged.map((row) => ({
        id: row.id,
        accountId: row.suggestedAccountId,
        type: row.type,
        amountCents: row.amountCents,
        date: row.date,
        postedDate: row.postedDate,
        name: row.name,
        merchantName: row.merchantName,
      }));

      const assigned = assignMatches(forMatch, candidates);

      await prisma.$transaction(async (tx) => {
        for (const row of staged) {
          const match = assigned.get(row.id);
          await tx.plaidStagedTransaction.update({
            where: { id: row.id },
            data: {
              matchTransactionId: match?.transactionId ?? null,
              matchScore: match?.score ?? null,
              matchTier: match?.tier ?? null,
              matchReasonsJson: match ? JSON.stringify(match.reasons) : null,
            },
          });
        }
      }, LONG_TRANSACTION_OPTIONS);

      return assigned.size;
    },
  };
}

/** Rows the review queue renders, shaped for the client. */
export type StagedQueueRow = Prisma.PlaidStagedTransactionGetPayload<{
  include: { plaidItem: { select: { institutionName: true } } };
}>;
