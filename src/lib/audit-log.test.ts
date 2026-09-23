import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordAuditLog,
  resolveAuditRetentionDays,
  scrubAuditMetadata,
  clientMetaFromHeaders,
  AUDIT_ACTIONS,
} from "./audit-log";
import { invalidateOpsSettingsCache } from "./ops-settings";
import { encryptSecret } from "./security";

describe("scrubAuditMetadata", () => {
  it("removes secret-like keys and truncates long strings", () => {
    const out = scrubAuditMetadata({
      ok: true,
      accessToken: "x",
      password: "nope",
      nested: { clientSecret: "shh", safe: "hi" },
      long: "a".repeat(600),
    });
    expect(out).not.toHaveProperty("password");
    expect(out).not.toHaveProperty("accessToken");
    expect(out).not.toHaveProperty("clientSecret");
    expect((out as { nested: { safe: string } }).nested.safe).toBe("hi");
    expect(String((out as { long: string }).long).length).toBeLessThanOrEqual(501);
  });
});

describe("clientMetaFromHeaders", () => {
  it("prefers first x-forwarded-for hop", () => {
    const h = new Headers({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      "user-agent": "TestUA/1",
    });
    expect(clientMetaFromHeaders(h)).toEqual({ ipAddress: "203.0.113.1", userAgent: "TestUA/1" });
  });
});

describe("recordAuditLog", () => {
  it("does not throw when prisma.create rejects", async () => {
    const prisma = {
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error("db down")),
      },
    } as never;
    await expect(
      recordAuditLog(prisma, {
        userId: "u1",
        action: AUDIT_ACTIONS.user_password_changed,
        metadata: { token: "x" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveAuditRetentionDays", () => {
  it("defaults to a year and ignores anything that is not a positive integer", () => {
    expect(resolveAuditRetentionDays(undefined)).toBe(365);
    expect(resolveAuditRetentionDays("")).toBe(365);
    expect(resolveAuditRetentionDays("0")).toBe(365);
    expect(resolveAuditRetentionDays("-5")).toBe(365);
    expect(resolveAuditRetentionDays("abc")).toBe(365);
    expect(resolveAuditRetentionDays(" 90 ")).toBe(90);
  });
});

describe("audit retention sweep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prunes rows older than the retention window on the lucky roll, and never fails the write", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const deleteMany = vi.fn().mockRejectedValue(new Error("locked"));
    const prisma = { auditLog: { create: vi.fn().mockResolvedValue({}), deleteMany } } as never;
    await recordAuditLog(prisma, { userId: "u1", action: AUDIT_ACTIONS.user_password_changed });
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(364 * 24 * 60 * 60 * 1000);
  });

  it("does not sweep on other rolls", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const deleteMany = vi.fn();
    const prisma = { auditLog: { create: vi.fn().mockResolvedValue({}), deleteMany } } as never;
    await recordAuditLog(prisma, { userId: "u1", action: AUDIT_ACTIONS.user_password_changed });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("uses the retention saved under Operations when the env var is unset", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const saved = process.env.AUDIT_LOG_RETENTION_DAYS;
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    invalidateOpsSettingsCache();
    try {
      const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        auditLog: { create: vi.fn().mockResolvedValue({}), deleteMany },
        serverSetting: {
          aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 }, _max: { updatedAt: new Date(1) } }),
          findMany: vi
            .fn()
            .mockResolvedValue([{ key: "ops.auditRetentionDays", encryptedValue: encryptSecret("45") }]),
        },
      } as never;
      await recordAuditLog(prisma, { userId: "u1", action: AUDIT_ACTIONS.user_password_changed });
      const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
      const days = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(days)).toBe(45);
    } finally {
      if (saved === undefined) delete process.env.AUDIT_LOG_RETENTION_DAYS;
      else process.env.AUDIT_LOG_RETENTION_DAYS = saved;
      invalidateOpsSettingsCache();
    }
  });
});
