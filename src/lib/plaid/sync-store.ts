import { CategoryKind, PlaidItemStatus, PlaidStagedStatus } from "@prisma/client";
import { LONG_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import { selectActiveBudgetsByCategory } from "@/lib/budget-progress";
import { currentYmInTimeZone } from "@/lib/period-month";
import { ensureFallbackCategory } from "@/lib/fallback-categories";
import { outflowCents } from "@/lib/transfer-type";
import type { UserBudgetName } from "@/lib/plaid/category-map";
import {
  assignMatches,
  MATCH_DATE_TOLERANCE_DAYS,
  selectAutoLinks,
  type MatchCandidate,
  type StagedForMatch,
} from "@/lib/plaid/matcher";
import { loginWorks, syncFailed, syncSucceeded } from "@/lib/plaid/item-state";
import { openAccessToken } from "@/lib/plaid/service";
import { pruneSpentStagedRows } from "@/lib/plaid/purge";
import { linkStagedRow } from "@/lib/plaid/review";
import type { ExistingStagedRow } from "@/lib/plaid/sync-plan";
import type { SyncItemRecord, SyncStore } from "@/lib/plaid/sync";

/**
 * The Prisma half of the sync walk. Deliberately thin: every decision about what a page
 * *means* lives in `sync-plan.ts`, and this only applies it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function releaseSyncLock(itemId: string): Promise<void> {
  await prisma.plaidItem.updateMany({ where: { id: itemId }, data: { syncingSince: null } });
}

/** Everything a sync of this item needs, read once while its lock is held. */
async function loadSyncItemRecord(itemId: string): Promise<SyncItemRecord | null> {
  const item = await prisma.plaidItem.findUnique({
    where: { id: itemId },
    include: { plaidAccounts: true, user: { select: { timezone: true } } },
  });
  if (!item) return null;

  const [categories, budgets] = await Promise.all([
    prisma.category.findMany({
      where: { userId: item.userId },
      select: { id: true, name: true, kind: true },
    }),
    prisma.budget.findMany({
      where: { userId: item.userId },
      select: { categoryId: true, name: true, periodMonth: true },
    }),
  ]);

  const [fallbackExpense, fallbackIncome, transferCategory] = await Promise.all([
    ensureFallbackCategory(prisma, item.userId, CategoryKind.EXPENSE, categories),
    ensureFallbackCategory(prisma, item.userId, CategoryKind.INCOME, categories),
    ensureFallbackCategory(prisma, item.userId, CategoryKind.TRANSFER, categories),
  ]);

  // Which budget is in force is decided first, then labels are taken from it — picking
  // the labelled ones first would resurrect a name the user has since moved on from.
  const budgetNames: UserBudgetName[] = [];
  const activeBudgets = selectActiveBudgetsByCategory(
    budgets,
    currentYmInTimeZone(item.user.timezone),
  );
  for (const budget of activeBudgets.values()) {
    if (budget.name) budgetNames.push({ categoryId: budget.categoryId, name: budget.name });
  }

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
      budgetNames,
      itemDefaultCategoryId: item.defaultCategoryId,
      fallbackCategoryId: {
        [CategoryKind.EXPENSE]: fallbackExpense,
        [CategoryKind.INCOME]: fallbackIncome,
        [CategoryKind.TRANSFER]: transferCategory,
      },
    },
  };
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

      // Anything that fails between taking the lock and handing back the record (an access
      // token a rotated key can no longer decrypt, a database error) must give the lock back.
      // `syncPlaidItem` only releases a lock it was handed, so without this the bank would
      // read as "sync already running" until the stale threshold.
      try {
        return await loadSyncItemRecord(itemId);
      } catch (err) {
        await releaseSyncLock(itemId);
        throw err;
      }
    },

    releaseLock: releaseSyncLock,

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
        select: { id: true, type: true, amountCents: true },
      });
      // As money out, like the bank's figure: an income row the user booked as a transfer
      // stores the same money with the opposite sign.
      return new Map(rows.map((row) => [row.id, outflowCents(row.type, row.amountCents)]));
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
              resolvedTransactionId: upsert.resolvedTransactionId ?? null,
              ...shared,
            },
            // A status is only forced when a decision is being inherited; otherwise the
            // user's own decision on this row must survive an update.
            update: {
              ...shared,
              ...(upsert.status ? { status: upsert.status } : {}),
              ...(upsert.resolvedTransactionId
                ? { resolvedTransactionId: upsert.resolvedTransactionId }
                : {}),
            },
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
            where: {
              userId: item.userId,
              plaidTransactionId: { in: plan.flagRevised.map((r) => r.plaidTransactionId) },
            },
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
        data: input.error
          ? syncFailed({ error: input.error, needsReauth: input.needsReauth })
          : syncSucceeded(input),
      });
      if (!input.error) {
        // Conditional so a sync cannot revive a removed or errored item.
        await prisma.plaidItem.updateMany({
          where: { id: input.itemId, status: PlaidItemStatus.LOGIN_REQUIRED },
          data: loginWorks(),
        });
        // Withdrawn and superseded rows past their grace period — see pruneSpentStagedRows.
        await pruneSpentStagedRows(prisma, input.itemId, input.now);
      }
    },

    async matchPendingRows(item) {
      const staged = await prisma.plaidStagedTransaction.findMany({
        where: { userId: item.userId, plaidItemId: item.id, status: PlaidStagedStatus.NEEDS_REVIEW },
        select: {
          id: true,
          plaidTransactionId: true,
          plaidAccountRowId: true,
          isPending: true,
          suggestedAccountId: true,
          type: true,
          amountCents: true,
          date: true,
          postedDate: true,
          name: true,
          merchantName: true,
          plaidItem: { select: { institutionName: true } },
        },
      });
      if (staged.length === 0) return 0;

      // Reduced rather than spread: an initial 24-month backfill can stage thousands of
      // rows, and `Math.min(...arr)` passes every element as an argument.
      let minDate = Number.POSITIVE_INFINITY;
      let maxDate = Number.NEGATIVE_INFINITY;
      for (const row of staged) {
        const t = row.date.getTime();
        if (t < minDate) minDate = t;
        if (t > maxDate) maxDate = t;
      }
      const tolerance = MATCH_DATE_TOLERANCE_DAYS * DAY_MS;
      // One windowed scan for the whole batch rather than a query per row — this is the
      // query `Transaction(userId, date)` was added for.
      const candidateRows = await prisma.transaction.findMany({
        where: {
          userId: item.userId,
          date: {
            gte: new Date(minDate - tolerance),
            lte: new Date(maxDate + tolerance),
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

      const forMatch: (StagedForMatch & { isPending: boolean })[] = staged.map((row) => ({
        id: row.id,
        isPending: row.isPending,
        accountId: row.suggestedAccountId,
        type: row.type,
        amountCents: row.amountCents,
        date: row.date,
        postedDate: row.postedDate,
        name: row.name,
        merchantName: row.merchantName,
      }));

      const assigned = assignMatches(forMatch, candidates);
      const autoLinks = selectAutoLinks(forMatch, candidates, assigned);
      const stagedById = new Map(staged.map((row) => [row.id, row]));

      // Most rows have no match, and they all get identical (null) values — so they go in
      // one statement rather than one per row. An initial backfill can stage thousands,
      // and Prisma's interactive transactions run sequentially, so a write per row is the
      // difference between one round trip and several thousand.
      const unmatchedIds = staged.filter((row) => !assigned.has(row.id)).map((row) => row.id);

      await prisma.$transaction(async (tx) => {
        if (unmatchedIds.length > 0) {
          await tx.plaidStagedTransaction.updateMany({
            where: { id: { in: unmatchedIds } },
            data: {
              matchTransactionId: null,
              matchScore: null,
              matchTier: null,
              matchReasonsJson: null,
            },
          });
        }
        for (const [stagedId, match] of assigned) {
          await tx.plaidStagedTransaction.update({
            where: { id: stagedId },
            data: {
              matchTransactionId: match.transactionId,
              matchScore: match.score,
              matchTier: match.tier,
              matchReasonsJson: JSON.stringify(match.reasons),
            },
          });
        }

        // The bank and the user agree exactly — link it exactly as the review queue's Link
        // does. The user may have resolved the row, or linked the transaction elsewhere,
        // since the rows above were read; `linkStagedRow` refuses both and this skips them.
        for (const stagedId of autoLinks) {
          const row = stagedById.get(stagedId)!;
          await linkStagedRow(tx, {
            userId: item.userId,
            staged: {
              id: row.id,
              plaidTransactionId: row.plaidTransactionId,
              plaidItemId: item.id,
              plaidAccountRowId: row.plaidAccountRowId,
              institutionName: row.plaidItem.institutionName,
              type: row.type,
              amountCents: row.amountCents,
              date: row.date,
              postedDate: row.postedDate,
              suggestedAccountId: row.suggestedAccountId,
            },
            transactionId: assigned.get(stagedId)!.transactionId,
          });
        }
      }, LONG_TRANSACTION_OPTIONS);

      return assigned.size;
    },
  };
}
