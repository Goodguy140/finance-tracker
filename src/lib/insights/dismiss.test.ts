import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { insightDismissal: { upsert: vi.fn(), deleteMany: vi.fn() } } }));
vi.mock("@/lib/insights/load", () => ({
  loadInsights: vi.fn(async () => ({
    visible: [{ key: "fees", monthlyCents: 1_500 }],
    dismissed: [{ key: "old", annualCents: 9_000 }],
  })),
}));

const { prisma } = await import("@/lib/prisma");
const { dismissInsight, restoreInsight } = await import("./dismiss");

const user = { id: "u1", countryCode: "CA", timezone: "America/Halifax" };
const now = new Date("2026-11-03T12:00:00Z");

describe("dismissInsight", () => {
  beforeEach(() => vi.clearAllMocks());

  it("snoozes for 30 days and keeps the insight's yearly size, worked out on the server", async () => {
    await dismissInsight(user, "fees", "snooze", now);
    expect(vi.mocked(prisma.insightDismissal.upsert).mock.calls[0]?.[0]).toMatchObject({
      where: { userId_insightKey: { userId: "u1", insightKey: "fees" } },
      create: { snoozedUntil: new Date("2026-12-03T12:00:00Z"), dismissedCents: 18_000 },
    });
  });

  it("dismisses for good with no end date", async () => {
    await dismissInsight(user, "old", "forever", now);
    expect(vi.mocked(prisma.insightDismissal.upsert).mock.calls[0]?.[0]).toMatchObject({
      update: { snoozedUntil: null, dismissedCents: 9_000 },
    });
  });

  it("restores only the user's own dismissal", async () => {
    await restoreInsight("u1", "old");
    expect(prisma.insightDismissal.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", insightKey: "old" } });
  });
});
