import type { PlaidItemStatus, PlaidStagedStatus, PrismaClient } from "@prisma/client";

/**
 * Every bank connection on the server, for the admin who pays Plaid's per-item bill.
 *
 * Operational fields only: who owns it, whether it syncs, and why not. Balances and
 * transaction amounts are deliberately not selected — an admin needs to know a connection
 * is broken, not what is in it.
 */

export type AdminPlaidItemRow = {
  id: string;
  ownerEmail: string;
  institutionName: string | null;
  status: PlaidItemStatus;
  errorCode: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  consecutiveSyncFailures: number;
  nextSyncAttemptAt: string | null;
  consentExpiresAt: string | null;
  mappedAccounts: number;
  totalAccounts: number;
  needsReview: number;
  createdAt: string;
};

export type AdminPlaidOverview = {
  items: AdminPlaidItemRow[];
  byStatus: Record<PlaidItemStatus, number>;
  staged: Record<PlaidStagedStatus, number>;
  oldestNeedsReviewAt: string | null;
  /** Items Plaid bills for: everything not yet removed. */
  billableItems: number;
};

const ITEM_STATUSES: PlaidItemStatus[] = ["ACTIVE", "LOGIN_REQUIRED", "ERROR", "REMOVED"];
const STAGED_STATUSES: PlaidStagedStatus[] = [
  "NEEDS_REVIEW",
  "LINKED",
  "ADDED",
  "IGNORED",
  "REMOVED_BY_PLAID",
  "SUPERSEDED",
];

export async function getAdminPlaidOverview(prisma: PrismaClient): Promise<AdminPlaidOverview> {
  const [items, stagedGroups, oldest, reviewByItem] = await Promise.all([
    prisma.plaidItem.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        institutionName: true,
        status: true,
        errorCode: true,
        lastSyncedAt: true,
        lastSyncError: true,
        consecutiveSyncFailures: true,
        nextSyncAttemptAt: true,
        consentExpiresAt: true,
        createdAt: true,
        user: { select: { email: true } },
        plaidAccounts: { select: { accountId: true, syncEnabled: true } },
      },
    }),
    prisma.plaidStagedTransaction.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.plaidStagedTransaction.findFirst({
      where: { status: "NEEDS_REVIEW" },
      orderBy: { firstSeenAt: "asc" },
      select: { firstSeenAt: true },
    }),
    prisma.plaidStagedTransaction.groupBy({
      by: ["plaidItemId"],
      where: { status: "NEEDS_REVIEW" },
      _count: { _all: true },
    }),
  ]);

  const reviewCounts = new Map(reviewByItem.map((row) => [row.plaidItemId, row._count._all]));
  const byStatus = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<PlaidItemStatus, number>;
  for (const item of items) byStatus[item.status] += 1;
  const staged = Object.fromEntries(STAGED_STATUSES.map((s) => [s, 0])) as Record<PlaidStagedStatus, number>;
  for (const group of stagedGroups) staged[group.status] = group._count._all;

  return {
    items: items.map((item) => ({
      id: item.id,
      ownerEmail: item.user.email,
      institutionName: item.institutionName,
      status: item.status,
      errorCode: item.errorCode,
      lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: item.lastSyncError,
      consecutiveSyncFailures: item.consecutiveSyncFailures,
      nextSyncAttemptAt: item.nextSyncAttemptAt?.toISOString() ?? null,
      consentExpiresAt: item.consentExpiresAt?.toISOString() ?? null,
      mappedAccounts: item.plaidAccounts.filter((a) => a.accountId !== null && a.syncEnabled).length,
      totalAccounts: item.plaidAccounts.length,
      needsReview: reviewCounts.get(item.id) ?? 0,
      createdAt: item.createdAt.toISOString(),
    })),
    byStatus,
    staged,
    oldestNeedsReviewAt: oldest?.firstSeenAt.toISOString() ?? null,
    billableItems: items.length - byStatus.REMOVED,
  };
}
