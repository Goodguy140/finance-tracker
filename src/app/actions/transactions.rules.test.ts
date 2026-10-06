import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleContext } from "@/lib/transaction-rules-server";
import type { TransactionRuleInput } from "@/lib/transaction-rules";

const mockPrisma = vi.hoisted(() => ({
  account: { findFirst: vi.fn(), findMany: vi.fn() },
  category: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  transaction: { createMany: vi.fn() },
  transactionTag: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
const ruleContext = vi.hoisted(() => ({ current: null as null | RuleContext }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ AUDIT_ACTIONS: {}, recordAuditLog: vi.fn() }));
vi.mock("@/lib/transaction-rules-server", () => ({
  loadRuleContext: vi.fn(async () => ruleContext.current),
}));

const { importExpensesCsvAction } = await import("./transactions");

const baseRule: TransactionRuleInput = {
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
  setAccountId: "acc-card",
  appendNote: "streaming",
  addTagId: null,
};

function csvForm(rows: Record<string, string>[], mapping: Record<string, string>) {
  const data = new FormData();
  data.set("rowsJson", JSON.stringify(rows));
  data.set("fieldSelections", JSON.stringify([]));
  for (const [key, value] of Object.entries(mapping)) data.set(`map_${key}`, value);
  data.set("defaultAccountId", "acc-default");
  data.set("defaultCategoryId", "cat-default");
  return data;
}

function writtenRows() {
  return mockPrisma.transaction.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
}

describe("importExpensesCsvAction with rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.account.findFirst.mockResolvedValue({ id: "acc-default" });
    mockPrisma.category.findFirst.mockResolvedValue({ id: "cat-default" });
    mockPrisma.account.findMany.mockResolvedValue([
      { id: "acc-default", name: "Chequing" },
      { id: "acc-card", name: "Visa" },
    ]);
    mockPrisma.category.findMany.mockResolvedValue([
      { id: "cat-default", name: "Other" },
      { id: "cat-subs", name: "Subscriptions" },
      { id: "cat-food", name: "Food" },
    ]);
    ruleContext.current = {
      rules: [baseRule],
      learned: [{ title: "Tim Hortons", categoryId: "cat-food" }],
      hiddenTitleKeys: [],
    };
  });

  it("fills category, title, account and note from a rule, but keeps the statement's amount", async () => {
    expect(
      await importExpensesCsvAction(
        csvForm([{ Amount: "15.99", Desc: "NETFLIX.COM 866" }], { amount: "Amount", title: "Desc" }),
      ),
    ).toBeUndefined();
    expect(writtenRows()).toEqual([
      expect.objectContaining({
        title: "Netflix",
        categoryId: "cat-subs",
        accountId: "acc-card",
        note: "streaming",
        amountCents: 1599,
      }),
    ]);
  });

  it("tags the rows a tagging rule matches, by ids given to those rows", async () => {
    ruleContext.current = { ...ruleContext.current!, rules: [{ ...baseRule, addTagId: "tag-subs" }] };
    await importExpensesCsvAction(
      csvForm([{ Amount: "15.99", Desc: "NETFLIX.COM" }, { Amount: "5", Desc: "Corner shop" }], { amount: "Amount", title: "Desc" }),
    );
    const [netflix, shop] = writtenRows();
    expect(typeof netflix.id).toBe("string");
    expect(shop.id).toBeUndefined();
    expect(mockPrisma.transactionTag.createMany).toHaveBeenCalledWith({
      data: [{ transactionId: netflix.id, tagId: "tag-subs" }],
    });
  });

  it("writes no tags when no rule adds one", async () => {
    await importExpensesCsvAction(csvForm([{ Amount: "15.99", Desc: "NETFLIX.COM" }], { amount: "Amount", title: "Desc" }));
    expect(mockPrisma.transactionTag.createMany).not.toHaveBeenCalled();
  });

  it("lets a category or account named by the row win over the rule", async () => {
    await importExpensesCsvAction(
      csvForm([{ Amount: "15.99", Desc: "NETFLIX", Cat: "Food", Acct: "Chequing" }], {
        amount: "Amount",
        title: "Desc",
        categoryName: "Cat",
        accountName: "Acct",
      }),
    );
    expect(writtenRows()[0]).toMatchObject({ categoryId: "cat-food", accountId: "acc-default", title: "Netflix" });
  });

  it("falls back to a learned combo, unless it is hidden, then to the default", async () => {
    await importExpensesCsvAction(
      csvForm([{ Amount: "2.10", Desc: "tim hortons" }, { Amount: "5", Desc: "Unknown shop" }], { amount: "Amount", title: "Desc" }),
    );
    expect(writtenRows().map((row) => row.categoryId)).toEqual(["cat-food", "cat-default"]);

    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    ruleContext.current = { ...ruleContext.current!, hiddenTitleKeys: ["tim hortons"] };
    await importExpensesCsvAction(csvForm([{ Amount: "2.10", Desc: "tim hortons" }], { amount: "Amount", title: "Desc" }));
    expect(writtenRows()[0]).toMatchObject({ categoryId: "cat-default" });
  });

  it("ignores a rule account that is archived (not in the active list)", async () => {
    ruleContext.current = { ...ruleContext.current!, rules: [{ ...baseRule, setAccountId: "acc-archived" }] };
    await importExpensesCsvAction(csvForm([{ Amount: "15.99", Desc: "NETFLIX" }], { amount: "Amount", title: "Desc" }));
    expect(writtenRows()[0]).toMatchObject({ accountId: "acc-default" });
  });
});
