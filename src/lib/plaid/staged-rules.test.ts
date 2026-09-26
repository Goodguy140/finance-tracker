import { describe, expect, it } from "vitest";
import { proposeForStagedRow, type StagedRuleInput } from "./staged-rules";
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
