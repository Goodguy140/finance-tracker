import type { PrismaClient } from "@prisma/client";

export type AdminAnalytics = {
  users: { total: number; serverAdmins: number; withPassword: number };
  data: {
    accounts: number;
    transactions: number;
    categories: number;
    recurringEnabled: number;
  };
  activity: {
    transactionsLast7Days: number;
    transactionsLast30Days: number;
    auditEventsLast7Days: number;
    newestUserAt: string | null;
    newestTransactionAt: string | null;
  };
  recentAuditActions: { action: string; count: number }[];
};

export async function getAdminAnalytics(prisma: PrismaClient): Promise<AdminAnalytics> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    usersTotal,
    serverAdmins,
    withPassword,
    accounts,
    transactions,
    categories,
    recurringEnabled,
    transactionsLast7Days,
    transactionsLast30Days,
    auditEventsLast7Days,
    newestUser,
    newestTransaction,
    recentAuditGroups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "SERVER_ADMIN" } }),
    prisma.user.count({ where: { passwordHash: { not: null } } }),
    prisma.account.count(),
    prisma.transaction.count(),
    prisma.category.count(),
    prisma.recurringTransaction.count({ where: { enabled: true } }),
    prisma.transaction.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.transaction.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.auditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.user.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.transaction.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
      take: 8,
    }),
  ]);

  return {
    users: { total: usersTotal, serverAdmins, withPassword },
    data: { accounts, transactions, categories, recurringEnabled },
    activity: {
      transactionsLast7Days,
      transactionsLast30Days,
      auditEventsLast7Days,
      newestUserAt: newestUser?.createdAt.toISOString() ?? null,
      newestTransactionAt: newestTransaction?.createdAt.toISOString() ?? null,
    },
    recentAuditActions: recentAuditGroups.map((g) => ({
      action: g.action,
      count: g._count.action,
    })),
  };
}
