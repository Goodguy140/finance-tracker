/**
 * What an admin should look at first, derived from facts gathered elsewhere.
 *
 * Pure on purpose: the thresholds are the part worth testing, and a function of plain
 * values can be tested without a database. The Overview page renders the list; the nav
 * turns it into a dot on each section that has something open.
 */

export type AttentionSeverity = "bad" | "warn";

export type AdminNavSection = "overview" | "users" | "authentication" | "integrations" | "operations" | "system";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  section: AdminNavSection;
};

export type AdminNavBadges = Partial<Record<AdminNavSection, AttentionSeverity>>;

export type AttentionFacts = {
  /** Columns the repair script expects but the database lacks. Empty when fine or not SQLite. */
  schemaMissingColumns: string[];
  /** ServerSetting keys that no longer decrypt with the current key. */
  undecryptableSettingKeys: string[];
  /** Required env vars that are missing or invalid. */
  requiredEnvProblems: string[];
  oauthWarningCount: number;
  plaidWarningCount: number;
  plaidItemsLoginRequired: number;
  plaidItemsErrored: number;
  plaidItemsConsentExpiringSoon: number;
  /** Oldest NEEDS_REVIEW staged row across every user, if any. */
  oldestReviewFirstSeenAt: Date | null;
  failedLoginsLast24h: number;
  activeServerAdmins: number;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
  /** Automatic backups are on, the database is a file, and the sweep runs in this process. */
  backupsExpected: boolean;
  newestBackupAt: Date | null;
  /** The backup sweep's last error, if its last tick failed. */
  backupFailure: string | null;
  backupSchedulerStartedAt: Date | null;
};

export const REVIEW_BACKLOG_STALE_DAYS = 14;
export const FAILED_LOGIN_SPIKE_THRESHOLD = 20;
/** Below this share of the volume free, SQLite writes are at risk soon enough to mention. */
export const LOW_DISK_FREE_RATIO = 0.1;
/** A daily backup missed twice in a row. */
export const BACKUP_STALE_DAYS = 2;
/** How long a fresh server may run before having no backup at all is worth a mention. */
const FIRST_BACKUP_GRACE_MS = 26 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildAttentionItems(facts: AttentionFacts, now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (facts.schemaMissingColumns.length > 0) {
    items.push({
      id: "schema-drift",
      severity: "bad",
      title: "Database schema is missing columns",
      detail: `Missing: ${facts.schemaMissingColumns.join(", ")}. Restart the container or run the schema repair script.`,
      href: "/settings/admin/system",
      section: "system",
    });
  }

  if (facts.undecryptableSettingKeys.length > 0) {
    items.push({
      id: "settings-decrypt",
      severity: "bad",
      title: "Stored settings cannot be decrypted",
      detail: `${plural(facts.undecryptableSettingKeys.length, "setting")} no longer decrypt, so SERVER_SETTINGS_ENCRYPTION_KEY has probably changed.`,
      href: "/settings/admin/system",
      section: "system",
    });
  }

  if (facts.requiredEnvProblems.length > 0) {
    items.push({
      id: "required-env",
      severity: "bad",
      title: "Required environment is incomplete",
      detail: facts.requiredEnvProblems.join(", "),
      href: "/settings/admin/system",
      section: "system",
    });
  }

  if (facts.activeServerAdmins <= 1) {
    items.push({
      id: "single-admin",
      severity: "warn",
      title: "Only one active server admin",
      detail: "If that account loses access, nobody can manage this server from the UI. Consider promoting a second admin.",
      href: "/settings/admin/users",
      section: "users",
    });
  }

  if (facts.failedLoginsLast24h > FAILED_LOGIN_SPIKE_THRESHOLD) {
    items.push({
      id: "failed-logins",
      severity: "warn",
      title: "Many failed sign-ins in the last 24 hours",
      detail: `${plural(facts.failedLoginsLast24h, "failed attempt")}. Check the audit log for the addresses involved.`,
      href: "/settings/admin/audit?action=user_login_failed",
      section: "overview",
    });
  }

  if (facts.oauthWarningCount > 0) {
    items.push({
      id: "oauth-warnings",
      severity: "warn",
      title: "Single sign-on configuration has warnings",
      detail: plural(facts.oauthWarningCount, "warning"),
      href: "/settings/admin/authentication",
      section: "authentication",
    });
  }

  const brokenBanks = facts.plaidItemsLoginRequired + facts.plaidItemsErrored;
  if (brokenBanks > 0) {
    const parts: string[] = [];
    if (facts.plaidItemsLoginRequired > 0) parts.push(`${facts.plaidItemsLoginRequired} awaiting re-authentication`);
    if (facts.plaidItemsErrored > 0) parts.push(`${facts.plaidItemsErrored} in error`);
    items.push({
      id: "plaid-items",
      severity: "warn",
      title: `${plural(brokenBanks, "bank connection")} not syncing`,
      detail: `${parts.join(", ")}. Each one is still billed monthly by Plaid.`,
      href: "/settings/admin/integrations",
      section: "integrations",
    });
  }

  if (facts.plaidItemsConsentExpiringSoon > 0) {
    items.push({
      id: "plaid-consent",
      severity: "warn",
      title: `${plural(facts.plaidItemsConsentExpiringSoon, "bank connection")} losing consent soon`,
      detail: "Consent expires within 14 days; the owner has to reconnect to keep syncing.",
      href: "/settings/admin/integrations",
      section: "integrations",
    });
  }

  if (facts.plaidWarningCount > 0) {
    items.push({
      id: "plaid-warnings",
      severity: "warn",
      title: "Plaid configuration has warnings",
      detail: plural(facts.plaidWarningCount, "warning"),
      href: "/settings/admin/integrations",
      section: "integrations",
    });
  }

  if (facts.oldestReviewFirstSeenAt) {
    const ageDays = Math.floor((now.getTime() - facts.oldestReviewFirstSeenAt.getTime()) / DAY_MS);
    if (ageDays >= REVIEW_BACKLOG_STALE_DAYS) {
      items.push({
        id: "review-backlog",
        severity: "warn",
        title: "Synced transactions waiting a long time for review",
        detail: `The oldest has been waiting ${ageDays} days. Only its owner can review it.`,
        href: "/settings/admin/integrations",
        section: "integrations",
      });
    }
  }

  if (facts.diskFreeGb != null && facts.diskTotalGb != null && facts.diskTotalGb > 0) {
    const ratio = facts.diskFreeGb / facts.diskTotalGb;
    if (ratio < LOW_DISK_FREE_RATIO) {
      items.push({
        id: "low-disk",
        severity: ratio < LOW_DISK_FREE_RATIO / 2 ? "bad" : "warn",
        title: "Database volume is nearly full",
        detail: `${facts.diskFreeGb} GB free of ${facts.diskTotalGb} GB.`,
        href: "/settings/admin/system",
        section: "system",
      });
    }
  }

  if (facts.backupsExpected) {
    if (facts.backupFailure) {
      items.push({
        id: "backup-failed",
        severity: "bad",
        title: "The last database backup failed",
        detail: facts.backupFailure,
        href: "/settings/admin/operations",
        section: "operations",
      });
    } else if (facts.newestBackupAt) {
      const ageDays = Math.floor((now.getTime() - facts.newestBackupAt.getTime()) / DAY_MS);
      if (ageDays >= BACKUP_STALE_DAYS) {
        items.push({
          id: "backup-stale",
          severity: "warn",
          title: "No recent database backup",
          detail: `The newest backup is ${ageDays} days old.`,
          href: "/settings/admin/operations",
          section: "operations",
        });
      }
    } else if (
      facts.backupSchedulerStartedAt &&
      now.getTime() - facts.backupSchedulerStartedAt.getTime() >= FIRST_BACKUP_GRACE_MS
    ) {
      items.push({
        id: "backup-stale",
        severity: "warn",
        title: "No database backup yet",
        detail: "Backups are on but none has been saved. Check the backups folder can be written.",
        href: "/settings/admin/operations",
        section: "operations",
      });
    }
  }

  // Worst first, so the top of the list is always the thing to do next.
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bad" ? -1 : 1));
}

export function navBadgesFromAttention(items: AttentionItem[]): AdminNavBadges {
  const badges: AdminNavBadges = {};
  for (const item of items) {
    if (badges[item.section] !== "bad") badges[item.section] = item.severity;
    if (badges.overview !== "bad") badges.overview = item.severity;
  }
  return badges;
}
