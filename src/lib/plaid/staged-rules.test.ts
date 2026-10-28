import { describe, expect, it } from "vitest";
import {
  defaultStagedType,
  makeStagedProposer,
  proposeForStagedRow,
  proposeStagedRowAs,
  type StagedRuleInput,
} from "./staged-rules";
import type { RuleTransactionType, TransactionRuleInput } from "@/lib/transaction-rules";

const rule: TransactionRuleInput = {
  id: "r1",
  priority: 0,
  enabled: true,
  titleOperator: "CONTAINS",
  titlePattern: "netflix",
  transactionType: null,
  matchAccountId: null,
  minAmountCents: null,
  maxAmountCents: null,
  setCategoryId: "cat-subs",
  setTitle: "Netflix",
  setAmountCents: 999,
  setAccountId: "acc-other",
  appendNote: "streaming",
  addTagId: null,
  markAsTransfer: false,
  setTransferAccountId: null,
  splitBy: [],
};

const kinds = new Map<string, RuleTransactionType>([
  ["cat-subs", "EXPENSE"],
  ["cat-pfc", "EXPENSE"],
  ["cat-food", "EXPENSE"],
]);

const staged: StagedRuleInput = {
  name: "NETFLIX.COM 866-579-7172",
  merchantName: null,
  amountCents: 1599,
  type: "EXPENSE",
  suggestedAccountId: "acc-bank",
  suggestedCategoryId: "cat-pfc",
};

const noLearned = { learned: [], hiddenTitleKeys: [] };

describe("proposeForStagedRow", () => {
  it("replaces the sync's category and display name with the rule's, adding its note", () => {
    expect(proposeForStagedRow(staged, [rule], kinds, noLearned)).toEqual({
      title: "Netflix",
      categoryId: "cat-subs",
      note: "streaming",
      tagIds: [],
      markAsTransfer: false,
      transferAccountId: null,
      split: null,
      reason: "rule",
    });
  });

  it("carries the tags rules add, and counts a tag alone as a rule's doing", () => {
    const tagOnly = { ...rule, setCategoryId: null, setTitle: null, appendNote: null, addTagId: "tag-subs" };
    expect(proposeForStagedRow(staged, [tagOnly], kinds, noLearned)).toMatchObject({
      tagIds: ["tag-subs"],
      reason: "rule",
    });
  });

  it("matches on the merchant name when the raw description does not", () => {
    const row = { ...staged, name: "SQ *XYZ 1234", merchantName: "Netflix" };
    expect(proposeForStagedRow(row, [{ ...rule, setTitle: null }], kinds, noLearned)).toMatchObject({
      title: "Netflix",
      categoryId: "cat-subs",
    });
  });

  it("puts a refund (negative expense) in the rule's category too", () => {
    const refund = { ...staged, amountCents: -1599 };
    const ranged = { ...rule, minAmountCents: 1000, maxAmountCents: 2000 };
    expect(proposeForStagedRow(refund, [ranged], kinds, noLearned).categoryId).toBe("cat-subs");
  });

  it("uses a learned combo on the display name before the sync's category mapping", () => {
    const row = { ...staged, name: "TIM HORTONS #123", merchantName: "Tim Hortons" };
    const learned = { learned: [{ title: "tim hortons", categoryId: "cat-food" }], hiddenTitleKeys: [] };
    expect(proposeForStagedRow(row, [], kinds, learned)).toEqual({
      title: "Tim Hortons",
      categoryId: "cat-food",
      note: null,
      tagIds: [],
      markAsTransfer: false,
      transferAccountId: null,
      split: null,
      reason: "learned",
    });
  });

  it("leaves the sync's proposal alone when nothing matches", () => {
    const row = { ...staged, name: "GROCERY STORE", merchantName: null };
    expect(proposeForStagedRow(row, [rule], kinds, noLearned)).toMatchObject({
      categoryId: "cat-pfc",
      note: null,
      reason: null,
    });
  });
});

describe("proposeStagedRowAs", () => {
  const transferKinds = new Map<string, RuleTransactionType>([...kinds, ["cat-xfer", "TRANSFER"]]);
  const propose = makeStagedProposer({ rules: [{ ...rule, transactionType: "EXPENSE" }], ...noLearned }, transferKinds);
  const transferRow: StagedRuleInput = { ...staged, type: "TRANSFER", suggestedCategoryId: "cat-xfer" };

  it("applies an expenses-only rule when a transfer the sync guessed is booked as spending", () => {
    // The sync's transfer category is not an expense category, so it must not survive.
    expect(proposeStagedRowAs(propose, transferRow, "EXPENSE")).toMatchObject({
      title: "Netflix",
      categoryId: "cat-subs",
      reason: "rule",
    });
  });

  it("keeps the sync's category when the row is booked as the type the sync guessed", () => {
    expect(proposeStagedRowAs(propose, transferRow, "TRANSFER")).toMatchObject({
      title: "Netflix Com",
      categoryId: "cat-xfer",
      reason: null,
    });
  });

  it("drops the sync's category for a spending row booked as a transfer", () => {
    expect(proposeStagedRowAs(propose, staged, "TRANSFER").categoryId).toBeNull();
  });
});

describe("a rule that marks transfers", () => {
  const marking: TransactionRuleInput = {
    ...rule,
    titlePattern: "visa payment",
    transactionType: "EXPENSE",
    setCategoryId: null,
    setTitle: "Visa payment",
    setAmountCents: null,
    setAccountId: null,
    appendNote: null,
    markAsTransfer: true,
    setTransferAccountId: "acc-visa",
  };
  const propose = makeStagedProposer({ rules: [marking], ...noLearned }, kinds);
  const payment: StagedRuleInput = { ...staged, name: "VISA PAYMENT THANK YOU", amountCents: 50000 };

  it("offers a spending row as a transfer, and leaves others as the sync typed them", () => {
    expect(defaultStagedType(propose, payment)).toBe("TRANSFER");
    expect(defaultStagedType(propose, staged)).toBe("EXPENSE");
  });

  it("gives the transfer side the rule's title and other account", () => {
    expect(proposeStagedRowAs(propose, payment, "TRANSFER")).toMatchObject({
      title: "Visa payment",
      markAsTransfer: true,
      transferAccountId: "acc-visa",
      reason: "rule",
    });
  });

  it("does not name the row's own account as the other side", () => {
    const fromVisa = { ...payment, suggestedAccountId: "acc-visa" };
    expect(proposeStagedRowAs(propose, fromVisa, "TRANSFER").transferAccountId).toBeNull();
  });
});
