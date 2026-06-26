import { beforeEach, describe, expect, it, vi } from "vitest";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";

const mockPrisma = vi.hoisted(() => ({
  recurringTransaction: {
    findFirst: vi.fn(),
  },
  subscriptionMember: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const {
  createSubscriptionMemberAction,
  setSubscriptionShareStatusAction,
  skipRecurringOccurrenceAction,
} = await import("./subscriptions");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("subscription member actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects adding a member to a subscription the user does not own", async () => {
    mockPrisma.recurringTransaction.findFirst.mockResolvedValue(null);

    await expect(
      createSubscriptionMemberAction(
        form({ recurringTransactionId: "rule-x", name: "Sam", share: "5" }),
      ),
    ).rejects.toThrow("Subscription not found.");
    expect(mockPrisma.subscriptionMember.create).not.toHaveBeenCalled();
  });

  it("creates a member with the share converted to cents", async () => {
    mockPrisma.recurringTransaction.findFirst.mockResolvedValue({ id: "rule-1", name: "Netflix", type: "EXPENSE" });

    await createSubscriptionMemberAction(form({ recurringTransactionId: "rule-1", name: "Sam", share: "5.50" }));

    expect(mockPrisma.subscriptionMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", recurringTransactionId: "rule-1", name: "Sam", shareCents: 550 }),
    });
  });
});

describe("setSubscriptionShareStatusAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a member paid and credits the posted transaction", async () => {
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: "m1", recurringTransactionId: "rule-1" });
    const tx = {
      subscriptionShareStatus: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ member: { shareCents: 500 } }]),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1", amountCents: 2000, preCreditCents: null }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx));

    await setSubscriptionShareStatusAction(
      form({ memberId: "m1", expectedDate: "2026-07-01", field: "paid", value: "true" }),
    );

    expect(tx.subscriptionShareStatus.upsert).toHaveBeenCalled();
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { amountCents: 1500, preCreditCents: 2000, creditCents: 500, creditBreakdownJson: "[500]" },
    });
  });

  it("does not recompute credits when toggling bill-sent", async () => {
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: "m1", recurringTransactionId: "rule-1" });
    const tx = {
      subscriptionShareStatus: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn() },
      transaction: { findFirst: vi.fn(), update: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx));

    await setSubscriptionShareStatusAction(
      form({ memberId: "m1", expectedDate: "2026-07-01", field: "billSent", value: "true" }),
    );

    expect(tx.subscriptionShareStatus.upsert).toHaveBeenCalled();
    expect(tx.transaction.findFirst).not.toHaveBeenCalled();
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });
});

describe("skipRecurringOccurrenceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances the schedule without creating a transaction (skip once)", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          name: "Netflix",
          cadence: "MONTHLY",
          enabled: true,
          endDate: null,
          nextExpectedDate: dateFromYmd("2026-07-01"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx));

    await skipRecurringOccurrenceAction(
      form({ recurringTransactionId: "rule-1", expectedDate: "2026-07-01", reason: "skip_once" }),
    );

    expect(ymdFromDateUtc(tx.recurringTransaction.updateMany.mock.calls[0][0].data.nextExpectedDate)).toBe("2026-08-01");
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it("auto-matches an already-logged expense by title and links it before advancing", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          name: "Netflix",
          cadence: "MONTHLY",
          enabled: true,
          endDate: null,
          nextExpectedDate: dateFromYmd("2026-07-01"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { id: "txn-far", date: dateFromYmd("2026-07-10") },
          { id: "txn-near", date: dateFromYmd("2026-07-02") },
        ]),
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx));

    await skipRecurringOccurrenceAction(
      form({ recurringTransactionId: "rule-1", expectedDate: "2026-07-01", reason: "already_logged" }),
    );

    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-near" },
      data: { recurringTransactionId: "rule-1", recurringExpectedDate: dateFromYmd("2026-07-01") },
    });
    expect(ymdFromDateUtc(tx.recurringTransaction.updateMany.mock.calls[0][0].data.nextExpectedDate)).toBe("2026-08-01");
  });

  it("rejects when the occurrence has already moved on", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          name: "Netflix",
          cadence: "MONTHLY",
          enabled: true,
          endDate: null,
          nextExpectedDate: dateFromYmd("2026-08-01"),
        }),
        updateMany: vi.fn(),
      },
      transaction: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx));

    await expect(
      skipRecurringOccurrenceAction(
        form({ recurringTransactionId: "rule-1", expectedDate: "2026-07-01", reason: "skip_once" }),
      ),
    ).rejects.toThrow("already moved to a different expected date");
    expect(tx.recurringTransaction.updateMany).not.toHaveBeenCalled();
  });
});
