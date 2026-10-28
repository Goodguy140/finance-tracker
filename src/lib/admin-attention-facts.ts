import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { getAdminOauthStatus } from "@/lib/admin-oauth-status";
import { getAdminRuntimeMetrics } from "@/lib/admin-runtime-metrics";
import { getAdminSystemHealth } from "@/lib/admin-system-health";
import {
  buildAttentionItems,
  navBadgesFromAttention,
  type AdminNavBadges,
  type AttentionFacts,
  type AttentionItem,
} from "@/lib/admin-attention";
import { countActiveAdmins } from "@/lib/admin-users";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { databaseBackupSchedulerEnabled } from "@/lib/database-backup-scheduler";
import { getBackupDirectory, listBackupFiles } from "@/lib/database-backups";
import { getOpsSettingsStatus } from "@/lib/ops-settings";
import { getSchedulerHeartbeat } from "@/lib/scheduler-status";
import { getPlaidAdminStatus } from "@/lib/plaid/config";
import { prisma as defaultPrisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CONSENT_EXPIRY_WARNING_DAYS = 14;

export async function gatherAttentionFacts(prisma: PrismaClient, now = new Date()): Promise<AttentionFacts> {
  const soon = new Date(now.getTime() + CONSENT_EXPIRY_WARNING_DAYS * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [system, oauth, plaid, loginRequired, errored, consentSoon, oldestReview, failedLogins, activeAdmins] =
    await Promise.all([
      getAdminSystemHealth(prisma),
      getAdminOauthStatus(prisma),
      getPlaidAdminStatus(),
      prisma.plaidItem.count({ where: { status: "LOGIN_REQUIRED" } }),
      prisma.plaidItem.count({ where: { status: "ERROR" } }),
      // Both bounds are plain comparisons on a nullable column, so a NULL expiry (no
      // consent window at all) is excluded here, which is what we want: it cannot lapse.
      prisma.plaidItem.count({
        where: { status: { not: "REMOVED" }, consentExpiresAt: { gte: now, lte: soon } },
      }),
      prisma.plaidStagedTransaction.findFirst({
        where: { status: "NEEDS_REVIEW" },
        orderBy: { firstSeenAt: "asc" },
        select: { firstSeenAt: true },
      }),
      prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.user_login_failed, createdAt: { gte: dayAgo } },
      }),
      countActiveAdmins(prisma),
    ]);

  const runtime = getAdminRuntimeMetrics();
  const [ops, backupDir] = await Promise.all([getOpsSettingsStatus(prisma), getBackupDirectory(prisma)]);
  const backupBeat = getSchedulerHeartbeat("databaseBackup");
  const { migrationHealth, env } = system;

  return {
    schemaMissingColumns: migrationHealth.schema.status === "drift" ? migrationHealth.schema.missing : [],
    undecryptableSettingKeys: migrationHealth.oauth.failedKeys,
    requiredEnvProblems: Object.entries(env)
      .filter(([, presence]) => presence !== "present")
      .map(([name, presence]) => `${name} ${presence}`),
    oauthWarningCount:
      oauth.globalWarnings.length + oauth.google.warnings.length + oauth.authentik.warnings.length,
    plaidWarningCount: plaid.warnings.length,
    plaidItemsLoginRequired: loginRequired,
    plaidItemsErrored: errored,
    plaidItemsConsentExpiringSoon: consentSoon,
    oldestReviewFirstSeenAt: oldestReview?.firstSeenAt ?? null,
    failedLoginsLast24h: failedLogins,
    activeServerAdmins: activeAdmins,
    diskFreeGb: runtime.databaseFile.diskFreeGb,
    diskTotalGb: runtime.databaseFile.diskTotalGb,
    backupsExpected: ops.backupEnabled.value && backupDir !== null && databaseBackupSchedulerEnabled(),
    newestBackupAt: backupDir ? (listBackupFiles(backupDir)[0]?.createdAt ?? null) : null,
    backupFailure: backupBeat?.lastOk === false ? backupBeat.lastResult : null,
    backupSchedulerStartedAt: backupBeat ? new Date(backupBeat.startedAt) : null,
  };
}

/**
 * The layout (for the nav dots) and the Overview page (for the list) both need this; `cache`
 * makes it one round of queries per request rather than two.
 */
export const getAdminAttention = cache(
  async (): Promise<{ items: AttentionItem[]; badges: AdminNavBadges; facts: AttentionFacts }> => {
    const facts = await gatherAttentionFacts(defaultPrisma);
    const items = buildAttentionItems(facts);
    return { items, badges: navBadgesFromAttention(items), facts };
  },
);
