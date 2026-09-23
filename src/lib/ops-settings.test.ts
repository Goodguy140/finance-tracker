import { describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  DEFAULT_AUDIT_RETENTION_DAYS,
  DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
  parseAuditRetentionInput,
  parsePlaidSyncIntervalInput,
  resolveAuditRetention,
  resolveOpsSettings,
  resolvePlaidSyncInterval,
  resolvePublicSignup,
  resolveRecurringAutoPost,
} from "./ops-settings";

describe("resolvePublicSignup", () => {
  it("lets a set env var decide outright, whatever is stored", () => {
    expect(resolvePublicSignup({ envRaw: "true", storedRaw: "false" })).toMatchObject({
      value: true,
      source: "environment",
    });
    expect(resolvePublicSignup({ envRaw: "1", storedRaw: null }).value).toBe(true);
    // Any other value closes signup, as the env-only code did — including an empty string.
    expect(resolvePublicSignup({ envRaw: "", storedRaw: "true" })).toMatchObject({
      value: false,
      source: "environment",
      stored: true,
    });
    expect(resolvePublicSignup({ envRaw: "yes", storedRaw: "true" }).value).toBe(false);
  });

  it("uses the stored switch when the env var is unset", () => {
    expect(resolvePublicSignup({ envRaw: undefined, storedRaw: "true", nodeEnv: "production" })).toMatchObject({
      value: true,
      source: "database",
    });
    expect(resolvePublicSignup({ envRaw: undefined, storedRaw: "false", nodeEnv: "development" })).toMatchObject({
      value: false,
      source: "database",
    });
  });

  it("defaults to open in development and closed in production", () => {
    expect(resolvePublicSignup({ envRaw: undefined, storedRaw: null, nodeEnv: "development" })).toMatchObject({
      value: true,
      source: "default",
    });
    expect(resolvePublicSignup({ envRaw: undefined, storedRaw: null, nodeEnv: "production" })).toMatchObject({
      value: false,
      source: "default",
    });
    // An unreadable stored value (rotated key) is treated as absent, not as "off".
    expect(resolvePublicSignup({ envRaw: undefined, storedRaw: "garbage", nodeEnv: "development" }).source).toBe(
      "default",
    );
  });
});

describe("resolveAuditRetention", () => {
  it("prefers a valid env value, then the stored one, then the default", () => {
    expect(resolveAuditRetention({ envRaw: "90", storedRaw: "400" })).toMatchObject({ value: 90, source: "environment" });
    expect(resolveAuditRetention({ envRaw: undefined, storedRaw: "400" })).toMatchObject({ value: 400, source: "database" });
    expect(resolveAuditRetention({ envRaw: undefined, storedRaw: null })).toMatchObject({
      value: DEFAULT_AUDIT_RETENTION_DAYS,
      source: "default",
    });
  });

  it("treats an unparseable env value as unset rather than as zero", () => {
    for (const raw of ["0", "-5", "abc", ""]) {
      expect(resolveAuditRetention({ envRaw: raw, storedRaw: "120" })).toMatchObject({ value: 120, source: "database" });
    }
  });
});

describe("resolvePlaidSyncInterval", () => {
  it("never accepts a value below the floor from either source", () => {
    expect(resolvePlaidSyncInterval({ envRaw: "5", storedRaw: "10" })).toMatchObject({
      value: DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
      source: "default",
    });
    expect(resolvePlaidSyncInterval({ envRaw: undefined, storedRaw: "30" })).toMatchObject({
      value: 30,
      source: "database",
    });
    expect(resolvePlaidSyncInterval({ envRaw: "240", storedRaw: "30" })).toMatchObject({
      value: 240,
      source: "environment",
    });
  });
});

describe("resolveRecurringAutoPost", () => {
  it("lets the env var force the sweep off but not on", () => {
    expect(resolveRecurringAutoPost({ envRaw: "false", storedRaw: "true" })).toMatchObject({
      value: false,
      source: "environment",
    });
    expect(resolveRecurringAutoPost({ envRaw: "true", storedRaw: "false" })).toMatchObject({
      value: false,
      source: "database",
    });
    expect(resolveRecurringAutoPost({ envRaw: undefined, storedRaw: null })).toMatchObject({
      value: true,
      source: "default",
    });
  });
});

describe("resolveOpsSettings", () => {
  it("reads each setting's own env var", () => {
    const status = resolveOpsSettings(
      { auditRetentionDays: "200", plaidSyncIntervalMinutes: "45" },
      { AUDIT_LOG_RETENTION_DAYS: "60", NODE_ENV: "production" },
    );
    expect(status.auditRetentionDays).toMatchObject({ value: 60, source: "environment" });
    expect(status.plaidSyncIntervalMinutes).toMatchObject({ value: 45, source: "database" });
    expect(status.publicSignup).toMatchObject({ value: false, source: "default" });
    expect(status.recurringAutoPost).toMatchObject({ value: true, source: "default" });
  });
});

describe("form input parsing", () => {
  it("accepts retention inside the range only", () => {
    expect(parseAuditRetentionInput(String(AUDIT_RETENTION_MIN_DAYS))).toBe(AUDIT_RETENTION_MIN_DAYS);
    expect(parseAuditRetentionInput(" 400 ")).toBe(400);
    expect(() => parseAuditRetentionInput(String(AUDIT_RETENTION_MIN_DAYS - 1))).toThrow(/between/);
    expect(() => parseAuditRetentionInput(String(AUDIT_RETENTION_MAX_DAYS + 1))).toThrow(/between/);
    expect(() => parseAuditRetentionInput("0")).toThrow();
    expect(() => parseAuditRetentionInput("90.5")).toThrow(/whole number/);
    expect(() => parseAuditRetentionInput("")).toThrow(/whole number/);
  });

  it("accepts a sync interval inside the range only", () => {
    expect(parsePlaidSyncIntervalInput("15")).toBe(15);
    expect(parsePlaidSyncIntervalInput("1440")).toBe(1440);
    expect(() => parsePlaidSyncIntervalInput("14")).toThrow(/between/);
    expect(() => parsePlaidSyncIntervalInput("1441")).toThrow(/between/);
    expect(() => parsePlaidSyncIntervalInput("1e3")).toThrow(/whole number/);
  });
});
