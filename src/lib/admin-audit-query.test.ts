import { describe, expect, it, vi } from "vitest";
import {
  auditLogWhere,
  parseAuditLogSearchParams,
  queryAuditLog,
  type AuditLogFilters,
} from "./admin-audit-query";

function filters(overrides: Partial<AuditLogFilters> = {}): AuditLogFilters {
  return { action: null, actor: null, from: null, to: null, page: 1, ...overrides };
}

describe("parseAuditLogSearchParams", () => {
  it("defaults everything when nothing is supplied", () => {
    expect(parseAuditLogSearchParams({})).toEqual(filters());
  });

  it("collapses repeated params to the first value", () => {
    expect(parseAuditLogSearchParams({ action: ["a", "b"] }).action).toBe("a");
  });

  it("falls back to page one for junk rather than throwing", () => {
    // A bad query string must not error the whole admin page.
    for (const page of ["banana", "0", "-3", "", undefined]) {
      expect(parseAuditLogSearchParams({ page }).page).toBe(1);
    }
    expect(parseAuditLogSearchParams({ page: "4" }).page).toBe(4);
  });

  it("accepts only YYYY-MM-DD dates", () => {
    expect(parseAuditLogSearchParams({ from: "2026-03-04" }).from).toBe("2026-03-04");
    expect(parseAuditLogSearchParams({ from: "04/03/2026" }).from).toBeNull();
    expect(parseAuditLogSearchParams({ from: "2026-13-45" }).from).toBeNull();
  });

  it("treats blank strings as absent", () => {
    expect(parseAuditLogSearchParams({ action: "  ", actor: "" })).toEqual(filters());
  });
});

describe("auditLogWhere", () => {
  it("is empty when nothing is filtered", () => {
    expect(auditLogWhere(filters())).toEqual({});
  });

  it("matches an action exactly and an actor by substring", () => {
    expect(auditLogWhere(filters({ action: "user_login_failed", actor: "example.com" }))).toEqual({
      action: "user_login_failed",
      user: { email: { contains: "example.com" } },
    });
  });

  it("includes the whole of the final day in the range", () => {
    // `to` is inclusive; bounding at 23:59:59 would drop events in the last second.
    const where = auditLogWhere(filters({ from: "2026-03-04", to: "2026-03-05" }));
    expect(where.createdAt).toEqual({
      gte: new Date("2026-03-04T00:00:00.000Z"),
      lt: new Date("2026-03-06T00:00:00.000Z"),
    });
  });

  it("supports an open-ended range in either direction", () => {
    expect(auditLogWhere(filters({ from: "2026-03-04" })).createdAt).toEqual({
      gte: new Date("2026-03-04T00:00:00.000Z"),
    });
    expect(auditLogWhere(filters({ to: "2026-03-04" })).createdAt).toEqual({
      lt: new Date("2026-03-05T00:00:00.000Z"),
    });
  });
});

describe("queryAuditLog", () => {
  function client(rows: unknown[], total: number) {
    return {
      auditLog: {
        count: vi.fn().mockResolvedValue(total),
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };
  }

  const row = {
    id: "a1",
    createdAt: new Date("2026-03-04T05:06:07.000Z"),
    action: "user_login_failed",
    targetType: null,
    targetId: null,
    metadataJson: '{"reason":"invalid_password"}',
    ipAddress: "203.0.113.9",
    userAgent: "probe/1.0",
    user: { email: "a@example.com" },
  };

  it("serialises rows and flattens the actor email", async () => {
    const db = client([row], 1);
    const page = await queryAuditLog(db as never, filters());

    expect(page.rows[0]).toEqual({
      id: "a1",
      createdAt: "2026-03-04T05:06:07.000Z",
      actorEmail: "a@example.com",
      action: "user_login_failed",
      targetType: null,
      targetId: null,
      metadataJson: '{"reason":"invalid_password"}',
      ipAddress: "203.0.113.9",
      userAgent: "probe/1.0",
    });
  });

  it("reports a null actor for an orphaned row", async () => {
    // AuditLog.userId is SetNull, so rows outlive the account that caused them.
    const db = client([{ ...row, user: null }], 1);
    expect((await queryAuditLog(db as never, filters())).rows[0].actorEmail).toBeNull();
  });

  it("skips by page and reports the page count", async () => {
    const db = client([], 120);
    const page = await queryAuditLog(db as never, filters({ page: 3 }), 50);

    expect(db.auditLog.findMany.mock.calls[0][0]).toMatchObject({ skip: 100, take: 50 });
    expect(page.pageCount).toBe(3);
    expect(page.total).toBe(120);
  });

  it("reports one page, not zero, for an empty log", async () => {
    expect((await queryAuditLog(client([], 0) as never, filters())).pageCount).toBe(1);
  });

  it("counts and lists through the same where clause", async () => {
    const db = client([], 0);
    await queryAuditLog(db as never, filters({ action: "user_logout" }));

    expect(db.auditLog.count.mock.calls[0][0].where).toEqual({ action: "user_logout" });
    expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({ action: "user_logout" });
  });
});
