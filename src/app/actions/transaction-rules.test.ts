import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  account: { findFirst: vi.fn() },
  category: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  transaction: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  transactionRule: {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  hiddenTitleSuggestion: { upsert: vi.fn(), deleteMany: vi.fn() },
  tag: { findMany: vi.fn(), upsert: vi.fn() },
  transactionTag: { findMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { transaction_rule_applied: "transaction_rule_applied" },
  recordAuditLog: vi.fn(),
}));

const {
  applyTransactionRuleAction,
  createTransactionRuleAction,
  hideLearnedTitleAction,
  moveTransactionRuleAction,
  previewTransactionRuleAction,
} = await import("./transaction-rules");
const { recordAuditLog } = await import("@/lib/audit-log");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    userId: "user-1",
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
    setAmountCents: 1599,
    setAccountId: null,
    appendNote: null,
    addTagId: null,
    markAsTransfer: false,
    setTransferAccountId: null,
    splits: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("transaction rule actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma));
    mockPrisma.transactionRule.count.mockResolvedValue(0);
    mockPrisma.transactionRule.findFirst.mockResolvedValue(null);
  });

  describe("createTransactionRuleAction", () => {
    it("pins the rule to the category's type and appends it after the last rule", async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ kind: "EXPENSE" });
      mockPrisma.transactionRule.findFirst.mockResolvedValue({ priority: 4 });

      const result = await createTransactionRuleAction(
        form({ titleOperator: "CONTAINS", titlePattern: " Netflix ", setCategoryId: "cat-subs", setAmount: "15.99", minAmount: "" }),
      );

      expect(result).toBeUndefined();
      expect(mockPrisma.transactionRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          priority: 5,
          titlePattern: "Netflix",
          transactionType: "EXPENSE",
          setCategoryId: "cat-subs",
          setAmountCents: 1599,
          minAmountCents: null,
          setTitle: null,
        }),
      });
    });

    it("stores a split's lines in order, pinning the rule to expenses", async () => {
      mockPrisma.category.count.mockResolvedValue(2);
      const data = form({ titlePattern: "costco" });
      for (const [categoryId, percent] of [["cat-groceries", "70"], ["cat-household", "30"], ["", ""]]) {
        data.append("ruleSplitCategoryId", categoryId);
        data.append("ruleSplitPercent", percent);
      }

      expect(await createTransactionRuleAction(data)).toBeUndefined();
      expect(mockPrisma.transactionRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionType: "EXPENSE",
          setCategoryId: null,
          splits: {
            create: [
              { position: 0, categoryId: "cat-groceries", basisPoints: 7000 },
              { position: 1, categoryId: "cat-household", basisPoints: 3000 },
            ],
          },
        }),
      });
    });

    it("refuses a split that does not add up to 100%, or names a category that is not the user's", async () => {
      const split = (percents: string[]) => {
        const data = form({ titlePattern: "costco" });
        percents.forEach((percent, i) => {
          data.append("ruleSplitCategoryId", `cat-${i}`);
          data.append("ruleSplitPercent", percent);
        });
        return data;
      };
      expect(await createTransactionRuleAction(split(["70", "20"]))).toMatchObject({
        ok: false,
        error: expect.stringMatching(/add up to 100%/),
      });
      mockPrisma.category.count.mockResolvedValue(1);
      expect(await createTransactionRuleAction(split(["70", "30"]))).toMatchObject({
        ok: false,
        error: expect.stringMatching(/split category was not found/),
      });
      expect(mockPrisma.transactionRule.create).not.toHaveBeenCalled();
    });

    it("stores every text to match, one per line, skipping blanks", async () => {
      const data = form({ setTitle: "Internet bill" });
      for (const text of [" Bell Aliant Pap ", "", "Internet"]) data.append("titlePattern", text);

      expect(await createTransactionRuleAction(data)).toBeUndefined();
      expect(mockPrisma.transactionRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ titlePattern: "Bell Aliant Pap\nInternet" }),
      });
    });

    it("creates the tag a rule adds when the user does not have it yet", async () => {
      mockPrisma.tag.findMany.mockResolvedValue([]);
      mockPrisma.tag.upsert.mockResolvedValue({ id: "tag-new" });

      const result = await createTransactionRuleAction(form({ titlePattern: "uber", addTag: " #Reimbursable " }));

      expect(result).toBeUndefined();
      expect(mockPrisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_nameKey: { userId: "user-1", nameKey: "reimbursable" } },
          create: { userId: "user-1", name: "Reimbursable", nameKey: "reimbursable" },
        }),
      );
      expect(mockPrisma.transactionRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ addTagId: "tag-new", setCategoryId: null, transactionType: null }),
      });
    });

    it("refuses a category from the other side of the ledger", async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ kind: "INCOME" });
      const result = await createTransactionRuleAction(
        form({ titlePattern: "netflix", transactionType: "EXPENSE", setCategoryId: "cat-salary" }),
      );
      expect(result).toEqual({ ok: false, error: expect.stringContaining("That category is for income") });
      expect(mockPrisma.transactionRule.create).not.toHaveBeenCalled();
    });

    it("refuses a category the user does not own", async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      const result = await createTransactionRuleAction(form({ titlePattern: "netflix", setCategoryId: "someone-elses" }));
      expect(result).toEqual({ ok: false, error: "Selected category was not found." });
    });

    it("refuses a rule that sets nothing, or an inverted amount range", async () => {
      expect(await createTransactionRuleAction(form({ titlePattern: "netflix" }))).toMatchObject({
        ok: false,
        error: expect.stringContaining("at least one thing"),
      });
      expect(
        await createTransactionRuleAction(form({ titlePattern: "netflix", setTitle: "N", minAmount: "20", maxAmount: "10" })),
      ).toMatchObject({ ok: false, error: expect.stringContaining("minimum amount") });
      expect(mockPrisma.transactionRule.create).not.toHaveBeenCalled();
    });

    it("checks both accounts belong to the user", async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      const result = await createTransactionRuleAction(form({ titlePattern: "netflix", setAccountId: "acc-x" }));
      expect(result).toMatchObject({ ok: false });
      expect(mockPrisma.transactionRule.create).not.toHaveBeenCalled();
    });

    it("caps the number of rules", async () => {
      mockPrisma.transactionRule.count.mockResolvedValue(200);
      const result = await createTransactionRuleAction(form({ titlePattern: "netflix", setTitle: "Netflix" }));
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("up to 200 rules") });
    });
  });

  it("moves a rule by swapping it with its neighbour and renumbering", async () => {
    mockPrisma.transactionRule.findMany.mockResolvedValue([
      { id: "a", priority: 0 },
      { id: "b", priority: 3 },
      { id: "c", priority: 7 },
    ]);
    await moveTransactionRuleAction(form({ ruleId: "c", direction: "up" }));
    const writes = mockPrisma.transactionRule.update.mock.calls.map(([arg]) => [arg.where.id, arg.data.priority]);
    expect(writes).toEqual([
      ["c", 1],
      ["b", 2],
    ]);
  });

  it("hides a learned title by its normalised key", async () => {
    await hideLearnedTitleAction(form({ title: "  Tim Hortons " }));
    expect(mockPrisma.hiddenTitleSuggestion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "user-1", titleKey: "tim hortons" } }),
    );
  });

  describe("apply to past transactions", () => {
    beforeEach(() => {
      mockPrisma.transactionRule.findFirst.mockResolvedValue(ruleRow());
      mockPrisma.category.findMany.mockResolvedValue([
        { id: "cat-subs", kind: "EXPENSE" },
        { id: "cat-other", kind: "EXPENSE" },
      ]);
      mockPrisma.transaction.findMany.mockResolvedValue([
        { id: "t1", title: "NETFLIX.COM", type: "EXPENSE", amountCents: 1299, accountId: "a", categoryId: "cat-other", note: null, tags: [], _count: { owedShares: 0 } },
        { id: "t2", title: "Netflix", type: "EXPENSE", amountCents: 1599, accountId: "a", categoryId: "cat-subs", note: null, tags: [], _count: { owedShares: 0 } },
        { id: "t3", title: "Groceries", type: "EXPENSE", amountCents: 5000, accountId: "a", categoryId: "cat-other", note: null, tags: [], _count: { owedShares: 0 } },
      ]);
    });

    it("previews only the rows that would change, excluding split transactions in the query", async () => {
      const result = await previewTransactionRuleAction("rule-1");
      expect(result).toMatchObject({ ok: true, total: 1, sample: [{ id: "t1" }] });
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1", splitParts: { none: {} }, type: "EXPENSE" }),
        }),
      );
    });

    it("applies title and category but never the rule's amount, and audits it", async () => {
      const result = await applyTransactionRuleAction("rule-1");
      expect(result).toEqual({ ok: true, updated: 1 });
      expect(mockPrisma.transaction.update).toHaveBeenCalledTimes(1);
      const [{ where, data }] = mockPrisma.transaction.update.mock.calls[0];
      expect(where).toEqual({ id: "t1" });
      expect(data).toEqual({ title: "Netflix", categoryId: "cat-subs", accountId: "a", note: null });
      expect(data).not.toHaveProperty("amountCents");
      expect(recordAuditLog).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ action: "transaction_rule_applied", metadata: { updated: 1 } }),
      );
    });

    it("adds the rule's tag to rows that lack it, even when nothing else changes", async () => {
      mockPrisma.transactionRule.findFirst.mockResolvedValue(
        ruleRow({ setCategoryId: null, setTitle: null, setAmountCents: null, addTagId: "tag-subs" }),
      );
      mockPrisma.transaction.findMany.mockResolvedValue([
        { id: "t1", title: "NETFLIX.COM", type: "EXPENSE", amountCents: 1299, accountId: "a", categoryId: "c", note: null, tags: [], _count: { owedShares: 0 } },
        { id: "t2", title: "Netflix", type: "EXPENSE", amountCents: 1599, accountId: "a", categoryId: "c", note: null, tags: [{ tagId: "tag-subs" }], _count: { owedShares: 0 } },
      ]);
      mockPrisma.transactionTag.findMany.mockResolvedValue([]);

      expect(await applyTransactionRuleAction("rule-1")).toEqual({ ok: true, updated: 1 });
      expect(mockPrisma.transactionTag.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.transactionTag.createMany).toHaveBeenCalledWith({ data: [{ transactionId: "t1", tagId: "tag-subs" }] });
    });

    it("marks matching rows as transfers with the rule's other account, skipping ones with owed shares", async () => {
      mockPrisma.transactionRule.findFirst.mockResolvedValue(
        ruleRow({
          setCategoryId: null,
          setTitle: null,
          setAmountCents: null,
          markAsTransfer: true,
          setTransferAccountId: "acc-visa",
        }),
      );
      mockPrisma.transaction.findMany.mockResolvedValue([
        { id: "t1", title: "NETFLIX.COM", type: "EXPENSE", amountCents: 1299, accountId: "a", categoryId: "c", note: null, tags: [], _count: { owedShares: 0 } },
        { id: "t2", title: "Netflix", type: "EXPENSE", amountCents: 1599, accountId: "a", categoryId: "c", note: null, tags: [], _count: { owedShares: 1 } },
      ]);
      mockPrisma.transaction.findFirst.mockResolvedValue({
        id: "t1",
        type: "EXPENSE",
        amountCents: 1299,
        _count: { splitParts: 0, owedShares: 0 },
      });
      mockPrisma.category.findMany.mockResolvedValue([{ id: "cat-xfer", name: "Transfers", kind: "TRANSFER" }]);

      expect(await applyTransactionRuleAction("rule-1")).toEqual({ ok: true, updated: 1 });
      const updates = mockPrisma.transaction.update.mock.calls.map(([arg]) => arg);
      expect(updates).toContainEqual({
        where: { id: "t1" },
        data: { type: "TRANSFER", categoryId: "cat-xfer", amountCents: 1299 },
      });
      expect(updates).toContainEqual({ where: { id: "t1" }, data: { transferAccountId: "acc-visa" } });
      expect(updates.some((u) => u.where.id === "t2")).toBe(false);
    });

    it("refuses a rule the user does not own", async () => {
      mockPrisma.transactionRule.findFirst.mockResolvedValue(null);
      expect(await applyTransactionRuleAction("rule-x")).toEqual({ ok: false, error: "Rule not found." });
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    });
  });
});
