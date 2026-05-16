import { describe, expect, it, vi } from "vitest";
import { recordAuditLog, scrubAuditMetadata, clientMetaFromHeaders, AUDIT_ACTIONS } from "./audit-log";

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
