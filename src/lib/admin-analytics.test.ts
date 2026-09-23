import { describe, expect, it, vi } from "vitest";
import { getAdminAnalytics } from "./admin-analytics";

describe("getAdminAnalytics", () => {
  it("maps counts and the newest timestamps into the overview shape", async () => {
    const newest = new Date("2026-09-20T10:00:00Z");
    const count = vi.fn().mockResolvedValue(4);
    const prisma = {
      user: { count, findFirst: vi.fn().mockResolvedValue({ createdAt: newest }) },
      account: { count },
      transaction: { count, findFirst: vi.fn().mockResolvedValue(null) },
      category: { count },
      recurringTransaction: { count },
      auditLog: {
        count,
        groupBy: vi.fn().mockResolvedValue([{ action: "user_login_succeeded", _count: { action: 9 } }]),
      },
    } as never;

    const result = await getAdminAnalytics(prisma);
    expect(result.users).toEqual({ total: 4, serverAdmins: 4, withPassword: 4 });
    expect(result.activity.newestUserAt).toBe(newest.toISOString());
    expect(result.activity.newestTransactionAt).toBeNull();
    expect(result.recentAuditActions).toEqual([{ action: "user_login_succeeded", count: 9 }]);
  });
});
