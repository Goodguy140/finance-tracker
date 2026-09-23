import type { PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * Time series and breakdowns for the admin Analytics page.
 *
 * **Operational only.** Every query here selects timestamps, statuses and counts; none
 * selects an amount, a title, a category or anything else that says what someone spent.
 * An admin running the server needs to see that it is being used and whether it is
 * healthy, not other people's finances. `admin-analytics-series.test.ts` checks the
 * select shapes so this cannot drift quietly.
 *
 * Days are UTC. SQLite has no date_trunc, so rows are fetched as bare timestamps within the
 * range and bucketed here, which is cheap at self-hosted scale.
 */

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function parseAnalyticsRange(raw: string | string[] | undefined): AnalyticsRange {
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  return (ANALYTICS_RANGES as readonly number[]).includes(value) ? (value as AnalyticsRange) : 30;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Upper bound on rows pulled for one series, so a runaway table cannot stall the page. */
export const SERIES_ROW_CAP = 250_000;

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first UTC midnight in a range of `days` days ending today (inclusive). */
export function rangeStart(days: number, now = new Date()): Date {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayUtc - (days - 1) * DAY_MS);
}

/** Every day in the range, oldest first, as YYYY-MM-DD. */
export function dayKeys(days: number, now = new Date()): string[] {
  const start = rangeStart(days, now).getTime();
  return Array.from({ length: days }, (_, i) => utcDayKey(new Date(start + i * DAY_MS)));
}

/**
 * Counts per day, with a zero for every day nothing happened — a gap in a chart otherwise
 * reads as missing data rather than a quiet day. Timestamps outside the range are ignored.
 */
export function bucketByDay(dates: Date[], days: number, now = new Date()): number[] {
  const keys = dayKeys(days, now);
  const index = new Map(keys.map((key, i) => [key, i]));
  const counts = new Array<number>(keys.length).fill(0);
  for (const date of dates) {
    const i = index.get(utcDayKey(date));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

export type DailyPoint = {
  day: string;
  signups: number;
  transactions: number;
  auditEvents: number;
  loginsSucceeded: number;
  loginsFailed: number;
  bankRowsStaged: number;
};

export type AdminAnalyticsSeries = {
  range: AnalyticsRange;
  points: DailyPoint[];
  totals: Omit<DailyPoint, "day">;
  /** Same totals for the range immediately before, for "vs previous period". */
  previousTotals: Omit<DailyPoint, "day">;
  truncated: boolean;
};

type SeriesKey = Exclude<keyof DailyPoint, "day">;
const SERIES_KEYS: SeriesKey[] = [
  "signups",
  "transactions",
  "auditEvents",
  "loginsSucceeded",
  "loginsFailed",
  "bankRowsStaged",
];

function sumsFor(points: DailyPoint[]): Omit<DailyPoint, "day"> {
  const out = Object.fromEntries(SERIES_KEYS.map((k) => [k, 0])) as Omit<DailyPoint, "day">;
  for (const point of points) for (const key of SERIES_KEYS) out[key] += point[key];
  return out;
}

export async function getAdminAnalyticsSeries(
  prisma: PrismaClient,
  range: AnalyticsRange,
  now = new Date(),
): Promise<AdminAnalyticsSeries> {
  // Fetch twice the range so the previous period comes from the same queries.
  const span = range * 2;
  const since = rangeStart(span, now);
  const createdSince = { createdAt: { gte: since } };
  const take = SERIES_ROW_CAP;

  const [users, transactions, audit, staged] = await Promise.all([
    prisma.user.findMany({ where: createdSince, select: { createdAt: true }, take }),
    prisma.transaction.findMany({ where: createdSince, select: { createdAt: true }, take }),
    prisma.auditLog.findMany({ where: createdSince, select: { createdAt: true, action: true }, take }),
    prisma.plaidStagedTransaction.findMany({
      where: { firstSeenAt: { gte: since } },
      select: { firstSeenAt: true },
      take,
    }),
  ]);
  const truncated = [users, transactions, audit, staged].some((rows) => rows.length >= take);

  const loginsOk = audit.filter((r) => r.action === AUDIT_ACTIONS.user_login_succeeded).map((r) => r.createdAt);
  const loginsFailed = audit.filter((r) => r.action === AUDIT_ACTIONS.user_login_failed).map((r) => r.createdAt);

  const columns: Record<SeriesKey, number[]> = {
    signups: bucketByDay(users.map((r) => r.createdAt), span, now),
    transactions: bucketByDay(transactions.map((r) => r.createdAt), span, now),
    auditEvents: bucketByDay(audit.map((r) => r.createdAt), span, now),
    loginsSucceeded: bucketByDay(loginsOk, span, now),
    loginsFailed: bucketByDay(loginsFailed, span, now),
    bankRowsStaged: bucketByDay(staged.map((r) => r.firstSeenAt), span, now),
  };

  const allPoints: DailyPoint[] = dayKeys(span, now).map((day, i) => {
    const point = { day } as DailyPoint;
    for (const key of SERIES_KEYS) point[key] = columns[key][i];
    return point;
  });
  const previous = allPoints.slice(0, range);
  const points = allPoints.slice(range);

  return { range, points, totals: sumsFor(points), previousTotals: sumsFor(previous), truncated };
}

export type AdoptionStats = {
  users: number;
  activeUsers: number;
  suspended: number;
  admins: number;
  withPassword: number;
  withPasskey: number;
  withRecoveryCodes: number;
  withSso: number;
  ssoByProvider: { provider: string; users: number }[];
  activeApiTokens: number;
  apiTokensUsedLast30Days: number;
  usersActiveLast30Days: number;
  topFailedLoginSources: { ip: string; count: number }[];
  topAuditActions: { action: string; count: number }[];
  budgetAlertEmailUsers: number;
};

/** Who uses which sign-in methods and features. Counts of accounts, never contents. */
export async function getAdminAdoptionStats(
  prisma: PrismaClient,
  range: AnalyticsRange,
  now = new Date(),
): Promise<AdoptionStats> {
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const sinceRange = rangeStart(range, now);
  const [
    users,
    suspended,
    admins,
    withPassword,
    passkeyUsers,
    recoveryUsers,
    ssoRows,
    activeApiTokens,
    apiTokensUsed,
    activeUsers,
    failedSources,
    topActions,
    budgetAlertEmailUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
    prisma.user.count({ where: { role: "SERVER_ADMIN", disabledAt: null } }),
    prisma.user.count({ where: { passwordHash: { not: null } } }),
    prisma.webAuthnCredential.groupBy({ by: ["userId"] }),
    prisma.recoveryCode.groupBy({ by: ["userId"], where: { usedAt: null } }),
    prisma.authAccount.groupBy({ by: ["provider", "userId"] }),
    prisma.personalAccessToken.count({
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    prisma.personalAccessToken.count({ where: { revokedAt: null, lastUsedAt: { gte: since30 } } }),
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { action: AUDIT_ACTIONS.user_login_succeeded, createdAt: { gte: since30 }, userId: { not: null } },
    }),
    prisma.auditLog.groupBy({
      by: ["ipAddress"],
      where: { action: AUDIT_ACTIONS.user_login_failed, createdAt: { gte: sinceRange }, ipAddress: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { ipAddress: "desc" } },
      take: 5,
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { createdAt: { gte: sinceRange } },
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 10,
    }),
    prisma.user.count({ where: { budgetAlertEmailEnabled: true } }),
  ]);

  const byProvider = new Map<string, number>();
  const ssoUsers = new Set<string>();
  for (const row of ssoRows) {
    byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + 1);
    ssoUsers.add(row.userId);
  }

  return {
    users,
    activeUsers: users - suspended,
    suspended,
    admins,
    withPassword,
    withPasskey: passkeyUsers.length,
    withRecoveryCodes: recoveryUsers.length,
    withSso: ssoUsers.size,
    ssoByProvider: [...byProvider.entries()]
      .map(([provider, count]) => ({ provider, users: count }))
      .sort((a, b) => b.users - a.users),
    activeApiTokens,
    apiTokensUsedLast30Days: apiTokensUsed,
    usersActiveLast30Days: activeUsers.length,
    topFailedLoginSources: failedSources.map((row) => ({ ip: row.ipAddress ?? "unknown", count: row._count._all })),
    topAuditActions: topActions.map((row) => ({ action: row.action, count: row._count._all })),
    budgetAlertEmailUsers,
  };
}

export type StorageRow = { table: string; rows: number };

/** Row counts per table, largest first. */
export async function getAdminStorageStats(prisma: PrismaClient): Promise<StorageRow[]> {
  const counts = await Promise.all([
    prisma.transaction.count().then((rows) => ({ table: "Transactions", rows })),
    prisma.auditLog.count().then((rows) => ({ table: "Audit log", rows })),
    prisma.plaidStagedTransaction.count().then((rows) => ({ table: "Staged bank rows", rows })),
    prisma.category.count().then((rows) => ({ table: "Categories", rows })),
    prisma.account.count().then((rows) => ({ table: "Accounts", rows })),
    prisma.budget.count().then((rows) => ({ table: "Budgets", rows })),
    prisma.recurringTransaction.count().then((rows) => ({ table: "Recurring rules", rows })),
    prisma.user.count().then((rows) => ({ table: "Users", rows })),
    prisma.plaidItem.count().then((rows) => ({ table: "Bank connections", rows })),
    prisma.rateLimitEntry.count().then((rows) => ({ table: "Rate-limit entries", rows })),
    prisma.serverSetting.count().then((rows) => ({ table: "Server settings", rows })),
  ]);
  return counts.sort((a, b) => b.rows - a.rows);
}
