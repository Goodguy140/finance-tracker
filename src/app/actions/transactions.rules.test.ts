import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleContext } from "@/lib/transaction-rules-server";
import type { TransactionRuleInput } from "@/lib/transaction-rules";

const mockPrisma = vi.hoisted(() => ({
  account: { findFirst: vi.fn(), findMany: vi.fn() },
  category: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  transaction: { createMany: vi.fn(), findMany: vi.fn() },
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
vi.mock("@/lib/fallback-categories", () => ({
  ensureFallbackCategoryFor: vi.fn(async (_client: unknown, _userId: string, kind: string) => `cat-${kind.toLowerCase()}`),
}));
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
  markAsTransfer: false,
  setTransferAccountId: null,
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
    mockPrisma.transaction.findMany.mockResolvedValue([]);
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
    ).toMatchObject({ ok: true, imported: 1 });
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

  it("books a line a marking rule matches as a transfer, naming the rule's other account", async () => {
    ruleContext.current = {
      ...ruleContext.current!,
      rules: [
        {
          ...baseRule,
          titlePattern: "visa payment",
          setCategoryId: null,
          setAccountId: null,
          appendNote: null,
          markAsTransfer: true,
          setTransferAccountId: "acc-card",
        },
      ],
    };
    await importExpensesCsvAction(
      csvForm(
        [
          { Amount: "500", Desc: "VISA PAYMENT THANK YOU" },
          { Amount: "5", Desc: "Corner shop" },
        ],
        { amount: "Amount", title: "Desc" },
      ),
    );
    const [payment, shop] = writtenRows();
    expect(payment).toMatchObject({
      type: "TRANSFER",
      categoryId: "cat-transfer",
      accountId: "acc-default",
      transferAccountId: "acc-card",
      amountCents: 50000,
      title: "Netflix",
    });
    expect(shop).toMatchObject({ type: "EXPENSE", categoryId: "cat-default" });
  });

  it("ignores a rule account that is archived (not in the active list)", async () => {
    ruleContext.current = { ...ruleContext.current!, rules: [{ ...baseRule, setAccountId: "acc-archived" }] };
    await importExpensesCsvAction(csvForm([{ Amount: "15.99", Desc: "NETFLIX" }], { amount: "Amount", title: "Desc" }));
    expect(writtenRows()[0]).toMatchObject({ accountId: "acc-default" });
  });
});

describe("importExpensesCsvAction dates and duplicates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.account.findFirst.mockResolvedValue({ id: "acc-default" });
    mockPrisma.category.findFirst.mockResolvedValue({ id: "cat-default" });
    mockPrisma.account.findMany.mockResolvedValue([{ id: "acc-default", name: "Chequing" }]);
    mockPrisma.category.findMany.mockResolvedValue([{ id: "cat-default", name: "Other" }]);
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    ruleContext.current = { rules: [], learned: [], hiddenTitleKeys: [] };
  });

  const mapping = { amount: "Amount", date: "Date", title: "Desc" };

  it("leaves out a row whose date cannot be read, instead of booking it today", async () => {
    const result = await importExpensesCsvAction(
      csvForm(
        [
          { Amount: "4.50", Date: "2026-03-02", Desc: "Coffee" },
          { Amount: "9.00", Date: "31/31/2026", Desc: "Lunch" },
          { Amount: "3.00", Date: "", Desc: "Snack" },
        ],
        mapping,
      ),
    );
    expect(writtenRows()).toEqual([expect.objectContaining({ title: "Coffee", date: new Date("2026-03-02T00:00:00Z") })]);
    expect(result).toMatchObject({
      ok: true,
      imported: 1,
      unreadableDates: [
        { row: 2, title: "Lunch", value: "31/31/2026", field: "date" },
        { row: 3, title: "Snack", value: "", field: "date" },
      ],
    });
  });

  it("leaves out a row whose posted date cannot be read", async () => {
    const result = await importExpensesCsvAction(
      csvForm([{ Amount: "4.50", Date: "2026-03-02", Posted: "soon", Desc: "Coffee" }], { ...mapping, postedDate: "Posted" }),
    );
    expect(mockPrisma.transaction.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ imported: 0, unreadableDates: [{ row: 1, field: "postedDate", value: "soon" }] });
  });

  it("still books today when the file names no date at all", async () => {
    const before = Date.now();
    await importExpensesCsvAction(csvForm([{ Amount: "4.50", Desc: "Coffee" }], { amount: "Amount", title: "Desc" }));
    expect((writtenRows()[0].date as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("skips a row matching an existing expense's date, amount and title, once per existing expense", async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { accountId: "acc-default", date: new Date("2026-03-02T00:00:00Z"), amountCents: 450, title: "coffee" },
    ]);
    const result = await importExpensesCsvAction(
      csvForm(
        [
          { Amount: "4.50", Date: "2026-03-02", Desc: "Coffee" },
          { Amount: "4.50", Date: "2026-03-02", Desc: "Coffee" },
          { Amount: "4.50", Date: "2026-03-03", Desc: "Coffee" },
          { Amount: "5.00", Date: "2026-03-02", Desc: "Coffee" },
        ],
        mapping,
      ),
    );
    expect(writtenRows()).toHaveLength(3);
    expect(result).toMatchObject({
      imported: 3,
      duplicates: [{ row: 1, title: "Coffee", date: "2026-03-02", amountCents: 450 }],
    });
    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          type: { in: ["EXPENSE", "TRANSFER", "INCOME"] },
          date: { gte: new Date("2026-03-02T00:00:00Z"), lt: new Date("2026-03-04T00:00:00Z") },
        }),
      }),
    );
  });

  it("does not take the same purchase on another account for a duplicate", async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { accountId: "acc-other", date: new Date("2026-03-02T00:00:00Z"), amountCents: 450, title: "coffee" },
    ]);
    const result = await importExpensesCsvAction(
      csvForm([{ Amount: "4.50", Date: "2026-03-02", Desc: "Coffee" }], mapping),
    );
    expect(writtenRows()).toHaveLength(1);
    expect(writtenRows()[0].accountId).toBe("acc-default");
    expect(result).toMatchObject({ imported: 1, duplicates: [] });
  });

  it("reads bank-style amounts, where spending is negative", async () => {
    const data = csvForm([{ Amount: "-4.50", Date: "2026-03-02", Desc: "Coffee" }, { Amount: "12.00", Date: "2026-03-02", Desc: "Refund" }], mapping);
    data.set("amountSign", "spending-negative");
    await importExpensesCsvAction(data);
    expect(writtenRows().map((r) => [r.title, r.type, r.amountCents])).toEqual([
      ["Coffee", "EXPENSE", 450],
      // Money in stays a refund (a negative expense) unless the user says it is income.
      ["Refund", "EXPENSE", -1200],
    ]);
  });

  it("books money in as income in the chosen category when asked, and spending as before", async () => {
    mockPrisma.category.findMany.mockImplementation(async (args: { where: { kind: string } }) =>
      args.where.kind === "INCOME" ? [{ id: "cat-salary", name: "Salary" }] : [{ id: "cat-default", name: "Other" }],
    );
    const data = csvForm(
      [
        { Debit: "4.50", Credit: "", Date: "2026-03-02", Desc: "Coffee" },
        { Debit: "", Credit: "2,500.00", Date: "2026-03-02", Desc: "Payroll" },
      ],
      { ...mapping, amount: "Debit", amountIn: "Credit" },
    );
    data.set("moneyIn", "income");
    data.set("defaultIncomeCategoryId", "cat-salary");
    const result = await importExpensesCsvAction(data);
    expect(writtenRows().map((r) => [r.title, r.type, r.amountCents, r.categoryId])).toEqual([
      ["Coffee", "EXPENSE", 450, "cat-default"],
      ["Payroll", "INCOME", 250_000, "cat-salary"],
    ]);
    expect(result).toMatchObject({ imported: 2, income: 1 });
  });

  it("refuses income without a category to book it in", async () => {
    const data = csvForm([{ Amount: "-4.50", Date: "2026-03-02", Desc: "x" }], mapping);
    data.set("moneyIn", "income");
    expect(await importExpensesCsvAction(data)).toMatchObject({ ok: false });
  });

  it("compares income with income already logged, not with expenses", async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { type: "INCOME", accountId: "acc-default", date: new Date("2026-03-02T00:00:00Z"), amountCents: 250_000, title: "payroll" },
      { type: "EXPENSE", accountId: "acc-default", date: new Date("2026-03-02T00:00:00Z"), amountCents: 450, title: "gift" },
    ]);
    const data = csvForm(
      [
        { Amount: "-2500", Date: "2026-03-02", Desc: "Payroll" },
        { Amount: "-4.50", Date: "2026-03-02", Desc: "Gift" },
      ],
      mapping,
    );
    data.set("moneyIn", "income");
    data.set("defaultIncomeCategoryId", "cat-default");
    const result = await importExpensesCsvAction(data);
    expect(writtenRows().map((r) => [r.title, r.type])).toEqual([["Gift", "INCOME"]]);
    expect(result).toMatchObject({ duplicates: [{ title: "Payroll", amountCents: 250_000 }] });
  });

  it("counts rows with no readable amount", async () => {
    const result = await importExpensesCsvAction(
      csvForm([{ Amount: "", Date: "2026-03-02", Desc: "x" }, { Amount: "abc", Date: "2026-03-02", Desc: "y" }], mapping),
    );
    expect(result).toMatchObject({ imported: 0, unreadableAmounts: 2 });
  });
});
