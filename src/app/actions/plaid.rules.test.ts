import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleContext } from "@/lib/transaction-rules-server";

const mockPrisma = vi.hoisted(() => ({
  plaidStagedTransaction: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  category: { findMany: vi.fn(), findFirst: vi.fn() },
  transaction: { create: vi.fn() },
  transactionVerification: { create: vi.fn() },
  $transaction: vi.fn(),
}));
const ruleContext = vi.hoisted(() => ({ current: null as null | RuleContext }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ AUDIT_ACTIONS: {}, recordAuditLog: vi.fn() }));
vi.mock("@/lib/plaid/service", () => ({}));
vi.mock("@/lib/plaid/sync", () => ({}));
vi.mock("@/lib/plaid-sync-scheduler", () => ({}));
vi.mock("@/lib/fallback-categories", () => ({
  ensureFallbackCategoryFor: vi.fn(async (_client: unknown, _userId: string, kind: string) => `cat-${kind.toLowerCase()}`),
}));
vi.mock("@/lib/transaction-rules-server", () => ({
  loadRuleContext: vi.fn(async () => ruleContext.current),
}));

const { bulkAddStagedTransactionsAction } = await import("./plaid");

function staged(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    userId: "user-1",
    name: "NETFLIX.COM 866",
    merchantName: null,
    amountCents: 1599,
    type: "EXPENSE",
    date: new Date("2026-09-01T00:00:00.000Z"),
    postedDate: null,
    suggestedAccountId: "acc-bank",
    suggestedCategoryId: "cat-pfc",
    plaidTransactionId: "ptx-1",
    plaidAccountRowId: "pa-1",
    plaidItem: { id: "item-1", institutionName: "Bank" },
    ...overrides,
  };
}

describe("bulkAddStagedTransactionsAction with rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });
    mockPrisma.plaidStagedTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.category.findMany.mockResolvedValue([
      { id: "cat-pfc", kind: "EXPENSE" },
      { id: "cat-subs", kind: "EXPENSE" },
    ]);
    ruleContext.current = {
      rules: [
        {
          id: "r1",
          priority: 0,
          enabled: true,
          titleOperator: "CONTAINS",
          titlePattern: "netflix",
          transactionType: "EXPENSE",
          matchAccountId: null,
          minAmountCents: null,
          maxAmountCents: null,
          setCategoryId: "cat-subs",
          setTitle: "Netflix",
          setAmountCents: 999,
          setAccountId: "acc-rule",
          appendNote: "streaming",
          addTagId: null,
          markAsTransfer: false,
          setTransferAccountId: null,
        },
      ],
      learned: [],
      hiddenTitleKeys: [],
    };
  });

  it("commits the rule's title, category and note but the bank's account and amount", async () => {
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({})]);
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1"]));

    expect(await bulkAddStagedTransactionsAction(data)).toBeUndefined();

    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Netflix",
        categoryId: "cat-subs",
        note: "streaming",
        accountId: "acc-bank",
        amountCents: 1599,
      }),
      select: { id: true },
    });
  });

  it("lets a rule supply the category a row had none for", async () => {
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({ suggestedCategoryId: null })]);
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1"]));

    expect(await bulkAddStagedTransactionsAction(data)).toBeUndefined();
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-subs" }) }),
    );
  });

  it("books a row a marking rule matches as a transfer, with the rule's other account", async () => {
    const rule = ruleContext.current!.rules[0];
    ruleContext.current = {
      ...ruleContext.current!,
      rules: [{ ...rule, setCategoryId: null, appendNote: null, markAsTransfer: true, setTransferAccountId: "acc-visa" }],
    };
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({ suggestedCategoryId: null })]);
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1"]));

    expect(await bulkAddStagedTransactionsAction(data)).toBeUndefined();
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "TRANSFER",
        categoryId: "cat-transfer",
        transferAccountId: "acc-visa",
        accountId: "acc-bank",
        amountCents: 1599,
        title: "Netflix",
      }),
      select: { id: true },
    });
  });
});

describe("bulkAddStagedTransactionsAction with a chosen category", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });
    mockPrisma.plaidStagedTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.category.findMany.mockResolvedValue([
      { id: "cat-pfc", kind: "EXPENSE" },
      { id: "cat-groceries", kind: "EXPENSE" },
    ]);
    ruleContext.current = { rules: [], learned: [], hiddenTitleKeys: [] };
  });

  it("books every row in that category, over what the sync suggested", async () => {
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({}), staged({ id: "s2", plaidTransactionId: "ptx-2" })]);
    mockPrisma.category.findFirst.mockResolvedValue({ kind: "EXPENSE" });
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1", "s2"]));
    data.set("categoryId", "cat-groceries");

    expect(await bulkAddStagedTransactionsAction(data)).toBeUndefined();
    expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(2);
    for (const [call] of mockPrisma.transaction.create.mock.calls) {
      expect(call.data).toMatchObject({ categoryId: "cat-groceries", type: "EXPENSE" });
    }
  });

  it("refuses a category of the wrong kind and writes nothing", async () => {
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({})]);
    mockPrisma.category.findFirst.mockResolvedValue({ kind: "INCOME" });
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1"]));
    data.set("categoryId", "cat-salary");

    expect(await bulkAddStagedTransactionsAction(data)).toMatchObject({ ok: false, error: expect.stringMatching(/not income/) });
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses a category that is not the user's", async () => {
    mockPrisma.plaidStagedTransaction.findMany.mockResolvedValue([staged({})]);
    mockPrisma.category.findFirst.mockResolvedValue(null);
    const data = new FormData();
    data.set("stagedIdsJson", JSON.stringify(["s1"]));
    data.set("categoryId", "someone-elses");

    expect(await bulkAddStagedTransactionsAction(data)).toMatchObject({ ok: false });
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });
});
