import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  savingsGoal: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));

const { contributeToSavingsGoalAction } = await import("./actions/savings-goals");

function contribution(amount: string) {
  const data = new FormData();
  data.set("goalId", "g1");
  data.set("amount", amount);
  return data;
}

describe("contributeToSavingsGoalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.savingsGoal.findFirst.mockResolvedValue({ id: "g1", userId: "u1", accountId: null, savedCents: 10_000 });
  });

  it("adds with an atomic increment, not by writing back a total read earlier", async () => {
    mockPrisma.savingsGoal.updateMany.mockResolvedValue({ count: 1 });

    expect(await contributeToSavingsGoalAction(contribution("25"))).toBeUndefined();

    expect(mockPrisma.savingsGoal.update).not.toHaveBeenCalled();
    expect(mockPrisma.savingsGoal.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "g1", accountId: null }),
      data: { savedCents: { increment: 2_500 } },
    });
  });

  it("refuses a deposit that would pass the largest amount allowed", async () => {
    mockPrisma.savingsGoal.updateMany.mockResolvedValue({ count: 0 });

    const result = await contributeToSavingsGoalAction(contribution("25"));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("largest amount") });
  });

  it("takes with an atomic decrement when there is enough saved", async () => {
    mockPrisma.savingsGoal.updateMany.mockResolvedValue({ count: 1 });

    await contributeToSavingsGoalAction(contribution("-40"));

    expect(mockPrisma.savingsGoal.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.savingsGoal.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "g1", savedCents: { gte: 4_000 } }),
      data: { savedCents: { decrement: 4_000 } },
    });
  });

  it("empties the goal when more is taken than is saved", async () => {
    mockPrisma.savingsGoal.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    await contributeToSavingsGoalAction(contribution("-500"));

    expect(mockPrisma.savingsGoal.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "g1", savedCents: { lt: 50_000 } }),
      data: { savedCents: 0 },
    });
  });
});
