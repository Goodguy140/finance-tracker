import { describe, expect, it } from "vitest";
import {
  FAILED_LOGIN_SPIKE_THRESHOLD,
  REVIEW_BACKLOG_STALE_DAYS,
  buildAttentionItems,
  navBadgesFromAttention,
  type AttentionFacts,
} from "./admin-attention";

const now = new Date("2026-09-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function healthy(overrides: Partial<AttentionFacts> = {}): AttentionFacts {
  return {
    schemaMissingColumns: [],
    undecryptableSettingKeys: [],
    requiredEnvProblems: [],
    oauthWarningCount: 0,
    plaidWarningCount: 0,
    plaidItemsLoginRequired: 0,
    plaidItemsErrored: 0,
    plaidItemsConsentExpiringSoon: 0,
    oldestReviewFirstSeenAt: null,
    failedLoginsLast24h: 0,
    activeServerAdmins: 2,
    diskFreeGb: 50,
    diskTotalGb: 100,
    backupsExpected: true,
    newestBackupAt: new Date(now.getTime() - 9 * 60 * 60 * 1000),
    backupFailure: null,
    backupSchedulerStartedAt: new Date(now.getTime() - 30 * DAY),
    ...overrides,
  };
}

const ids = (facts: AttentionFacts) => buildAttentionItems(facts, now).map((item) => item.id);

describe("buildAttentionItems", () => {
  it("is empty for a healthy server", () => {
    expect(buildAttentionItems(healthy(), now)).toEqual([]);
  });

  it("flags each problem on its own", () => {
    expect(ids(healthy({ schemaMissingColumns: ["Transaction.creditCents"] }))).toEqual(["schema-drift"]);
    expect(ids(healthy({ undecryptableSettingKeys: ["oauth.google.clientSecret"] }))).toEqual(["settings-decrypt"]);
    expect(ids(healthy({ requiredEnvProblems: ["NEXTAUTH_URL missing"] }))).toEqual(["required-env"]);
    expect(ids(healthy({ activeServerAdmins: 1 }))).toEqual(["single-admin"]);
    expect(ids(healthy({ oauthWarningCount: 2 }))).toEqual(["oauth-warnings"]);
    expect(ids(healthy({ plaidItemsErrored: 1 }))).toEqual(["plaid-items"]);
    expect(ids(healthy({ plaidItemsLoginRequired: 1 }))).toEqual(["plaid-items"]);
    expect(ids(healthy({ plaidItemsConsentExpiringSoon: 1 }))).toEqual(["plaid-consent"]);
    expect(ids(healthy({ plaidWarningCount: 1 }))).toEqual(["plaid-warnings"]);
  });

  it("only calls a failed-login count a spike above the threshold", () => {
    expect(ids(healthy({ failedLoginsLast24h: FAILED_LOGIN_SPIKE_THRESHOLD }))).toEqual([]);
    expect(ids(healthy({ failedLoginsLast24h: FAILED_LOGIN_SPIKE_THRESHOLD + 1 }))).toEqual(["failed-logins"]);
  });

  it("flags a review backlog only once it is old enough", () => {
    const fresh = new Date(now.getTime() - (REVIEW_BACKLOG_STALE_DAYS - 1) * DAY);
    const stale = new Date(now.getTime() - REVIEW_BACKLOG_STALE_DAYS * DAY);
    expect(ids(healthy({ oldestReviewFirstSeenAt: fresh }))).toEqual([]);
    expect(ids(healthy({ oldestReviewFirstSeenAt: stale }))).toEqual(["review-backlog"]);
  });

  it("grades low disk by how low it is, and ignores unknown sizes", () => {
    expect(ids(healthy({ diskFreeGb: 11, diskTotalGb: 100 }))).toEqual([]);
    expect(buildAttentionItems(healthy({ diskFreeGb: 8, diskTotalGb: 100 }), now)[0]?.severity).toBe("warn");
    expect(buildAttentionItems(healthy({ diskFreeGb: 3, diskTotalGb: 100 }), now)[0]?.severity).toBe("bad");
    expect(ids(healthy({ diskFreeGb: null, diskTotalGb: null }))).toEqual([]);
  });

  it("flags a failed or missed database backup, only while backups are expected", () => {
    expect(ids(healthy({ backupFailure: "Backup failed: disk I/O error" }))).toEqual(["backup-failed"]);
    expect(ids(healthy({ newestBackupAt: new Date(now.getTime() - 1.5 * DAY) }))).toEqual([]);
    expect(ids(healthy({ newestBackupAt: new Date(now.getTime() - 2 * DAY) }))).toEqual(["backup-stale"]);
    expect(ids(healthy({ backupsExpected: false, newestBackupAt: null, backupFailure: "x" }))).toEqual([]);
  });

  it("gives a new server a day before it mentions having no backup at all", () => {
    const startedAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    expect(ids(healthy({ newestBackupAt: null, backupSchedulerStartedAt: startedAgo(20) }))).toEqual([]);
    expect(ids(healthy({ newestBackupAt: null, backupSchedulerStartedAt: startedAgo(27) }))).toEqual(["backup-stale"]);
    expect(ids(healthy({ newestBackupAt: null, backupSchedulerStartedAt: null }))).toEqual([]);
  });

  it("lists problems before warnings", () => {
    const items = buildAttentionItems(healthy({ activeServerAdmins: 1, schemaMissingColumns: ["x"] }), now);
    expect(items.map((i) => i.severity)).toEqual(["bad", "warn"]);
  });
});

describe("navBadgesFromAttention", () => {
  it("marks each section by its worst item, and the overview by the worst of all", () => {
    const items = buildAttentionItems(
      healthy({ activeServerAdmins: 1, plaidItemsErrored: 1, schemaMissingColumns: ["x"] }),
      now,
    );
    expect(navBadgesFromAttention(items)).toEqual({
      overview: "bad",
      system: "bad",
      users: "warn",
      integrations: "warn",
    });
    expect(navBadgesFromAttention([])).toEqual({});
  });
});
