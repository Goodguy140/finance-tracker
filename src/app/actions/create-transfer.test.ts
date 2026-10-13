import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  account: { findFirst: vi.fn() },
  category: { findMany: vi.fn() },
  transaction: { create: vi.fn() },
  tag: { findMany: vi.fn(), upsert: vi.fn() },
  transactionTag: { findMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

const { createTransferAction } = await import("./transactions");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("createTransferAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.account.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
    mockPrisma.category.findMany.mockResolvedValue([{ id: "cat-xfer", name: "Transfers", kind: "TRANSFER" }]);
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });
  });

  it("records one transfer on the account the money left, naming the account it went to", async () => {
    const result = await createTransferAction(
      form({ fromAccountId: "acc-chq", toAccountId: "acc-visa", amount: "250.50", date: "2026-10-01", title: "Visa payment" }),
    );
    expect(result).toBeUndefined();
    expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        type: "TRANSFER",
        accountId: "acc-chq",
        transferAccountId: "acc-visa",
        categoryId: "cat-xfer",
        amountCents: 25050,
        date: new Date("2026-10-01T00:00:00Z"),
        title: "Visa payment",
      }),
      select: { id: true },
    });
  });

  it("refuses the same account on both sides", async () => {
    const result = await createTransferAction(
      form({ fromAccountId: "acc-chq", toAccountId: "acc-chq", amount: "10", date: "2026-10-01" }),
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("two different accounts") });
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses an account the user does not own", async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    const result = await createTransferAction(
      form({ fromAccountId: "acc-chq", toAccountId: "acc-other", amount: "10", date: "2026-10-01" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });
});
