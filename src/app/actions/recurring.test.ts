import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryKind, TransactionType } from "@prisma/client";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";

const mockPrisma = vi.hoisted(() => ({
  account: {
    findFirst: vi.fn(),
  },
  category: {
    findFirst: vi.fn(),
  },
  recurringTransaction: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const { createRecurringTransactionAction, postRecurringTransactionAction } = await import("./recurring");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

describe("recurring transaction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.account.findFirst.mockResolvedValue({ id: "account-1" });
  });

  it("validates income recurring rules against income categories", async () => {
    mockPrisma.category.findFirst.mockImplementation(async ({ where }: { where: { kind?: CategoryKind } }) =>
      where.kind === CategoryKind.INCOME ? null : { id: "category-1" },
    );

    expect(
      await createRecurringTransactionAction(
        form({
          type: "INCOME",
          accountId: "account-1",
          categoryId: "expense-category",
          name: "Paycheque",
          amount: "2500",
          cadence: "BIWEEKLY",
          nextExpectedDate: "2026-05-01",
        }),
      ),
    ).toEqual({ ok: false, error: "Selected category was not found." });

    expect(mockPrisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it("creates a recurring income rule with validated account and category ownership", async () => {
    mockPrisma.category.findFirst.mockResolvedValue({ id: "income-category" });

    await createRecurringTransactionAction(
      form({
        type: "INCOME",
        accountId: "account-1",
        categoryId: "income-category",
        name: "Paycheque",
        amount: "2500",
        cadence: "BIWEEKLY",
        nextExpectedDate: "2026-05-01",
        note: "Net pay",
      }),
    );

    expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
      where: { id: "account-1", userId: "user-1", archived: false },
      select: { id: true },
    });
    expect(mockPrisma.category.findFirst).toHaveBeenCalledWith({
      where: { id: "income-category", userId: "user-1", kind: CategoryKind.INCOME },
      select: { id: true },
    });
    expect(mockPrisma.recurringTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        type: TransactionType.INCOME,
        amountCents: 250_000,
        cadence: "BIWEEKLY",
        note: "Net pay",
      }),
    });
  });

  it("posting a recurring rule creates a transaction and advances the next expected date", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          userId: "user-1",
          accountId: "account-1",
          categoryId: "category-1",
          type: TransactionType.EXPENSE,
          name: "Rent",
          amountCents: 150_000,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-01-31"),
          endDate: null,
          note: "Apartment",
          enabled: true,
          account: { id: "account-1", archived: false },
          category: { id: "category-1", kind: CategoryKind.EXPENSE },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx));

    await postRecurringTransactionAction(
      form({
        recurringTransactionId: "rule-1",
        expectedDate: "2026-01-31",
      }),
    );

    expect(ymdFromDateUtc(tx.recurringTransaction.updateMany.mock.calls[0][0].data.nextExpectedDate)).toBe(
      "2026-02-28",
    );
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        accountId: "account-1",
        categoryId: "category-1",
        type: TransactionType.EXPENSE,
        amountCents: 150_000,
        title: "Rent",
        date: dateFromYmd("2026-01-31"),
        note: "Apartment",
        recurringTransactionId: "rule-1",
        recurringExpectedDate: dateFromYmd("2026-01-31"),
      }),
    });
  });

  it("applies credits for members already marked paid when posting", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          userId: "user-1",
          accountId: "account-1",
          categoryId: "category-1",
          type: TransactionType.EXPENSE,
          name: "Netflix",
          amountCents: 2_000,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-07-01"),
          endDate: null,
          note: null,
          enabled: true,
          account: { id: "account-1", archived: false },
          category: { id: "category-1", kind: CategoryKind.EXPENSE },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        // Expected date equals the rule's next date, so the idempotency branch is skipped and
        // findFirst is only called once, by the credit recompute, to locate the posted transaction.
        findFirst: vi.fn().mockResolvedValue({ id: "t1", amountCents: 2_000, preCreditCents: null }),
        create: vi.fn().mockResolvedValue({ id: "t1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptionShareStatus: {
        findMany: vi.fn().mockResolvedValue([{ member: { shareCents: 500 } }]),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx));

    await postRecurringTransactionAction(form({ recurringTransactionId: "rule-1", expectedDate: "2026-07-01" }));

    expect(tx.transaction.create).toHaveBeenCalled();
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { amountCents: 1_500, preCreditCents: 2_000, creditCents: 500, creditBreakdownJson: "[500]" },
    });
  });

  it("posts an automatic recurring expense into its expected month", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          userId: "user-1",
          accountId: "account-1",
          categoryId: "category-1",
          type: TransactionType.EXPENSE,
          name: "Storage",
          amountCents: 8_500,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-04-30"),
          endDate: null,
          note: null,
          enabled: true,
          account: { id: "account-1", archived: false },
          category: { id: "category-1", kind: CategoryKind.EXPENSE },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx));

    await postRecurringTransactionAction(
      form({
        recurringTransactionId: "rule-1",
        expectedDate: "2026-04-30",
      }),
    );

    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: TransactionType.EXPENSE,
        date: dateFromYmd("2026-04-30"),
        recurringExpectedDate: dateFromYmd("2026-04-30"),
      }),
    });
  });

  it("posting the same expected date twice is idempotent when it was already recorded", async () => {
    const tx = {
      recurringTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rule-1",
          userId: "user-1",
          type: TransactionType.EXPENSE,
          nextExpectedDate: dateFromYmd("2026-02-28"),
        }),
        updateMany: vi.fn(),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "txn-1" }),
        create: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx));

    await postRecurringTransactionAction(
      form({
        recurringTransactionId: "rule-1",
        expectedDate: "2026-01-31",
      }),
    );

    expect(tx.recurringTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
