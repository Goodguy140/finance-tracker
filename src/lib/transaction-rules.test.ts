import { describe, expect, it } from "vitest";
import {
  appendRuleNote,
  planRuleApplication,
  resolveRuleOutcome,
  ruleMatches,
  visibleLearnedSuggestions,
  type RuleSubject,
  type RuleTransactionType,
  type TransactionRuleInput,
} from "./transaction-rules";

function rule(overrides: Partial<TransactionRuleInput> = {}): TransactionRuleInput {
  return {
    id: "r1",
    priority: 0,
    enabled: true,
    titleOperator: "CONTAINS",
    titlePattern: "netflix",
    transactionType: null,
    matchAccountId: null,
    minAmountCents: null,
    maxAmountCents: null,
    setCategoryId: null,
    setTitle: null,
    setAmountCents: null,
    setAccountId: null,
    appendNote: null,
    ...overrides,
  };
}

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return { texts: ["NETFLIX.COM 866-579"], amountCents: 1599, accountId: "acc1", type: "EXPENSE", ...overrides };
}

const kinds = new Map<string, RuleTransactionType>([
  ["subs", "EXPENSE"],
  ["shopping", "EXPENSE"],
  ["salary", "INCOME"],
]);

describe("ruleMatches", () => {
  it("applies each text operator case-insensitively", () => {
    expect(ruleMatches(rule({ titleOperator: "CONTAINS", titlePattern: "Netflix" }), subject())).toBe(true);
    expect(ruleMatches(rule({ titleOperator: "STARTS_WITH", titlePattern: "netflix.com" }), subject())).toBe(true);
    expect(ruleMatches(rule({ titleOperator: "STARTS_WITH", titlePattern: "866" }), subject())).toBe(false);
    expect(ruleMatches(rule({ titleOperator: "EQUALS", titlePattern: "netflix" }), subject())).toBe(false);
    expect(ruleMatches(rule({ titleOperator: "EQUALS", titlePattern: " netflix " }), subject({ texts: ["NETFLIX"] }))).toBe(true);
  });

  it("matches if any of the subject texts does (bank name vs merchant name)", () => {
    expect(ruleMatches(rule({ titlePattern: "spotify" }), subject({ texts: ["SQ *XYZ", null, "Spotify"] }))).toBe(true);
    expect(ruleMatches(rule({ titlePattern: "spotify" }), subject({ texts: ["SQ *XYZ", null] }))).toBe(false);
  });

  it("compares the absolute amount so a refund matches the same range as the charge", () => {
    const ranged = rule({ minAmountCents: 1000, maxAmountCents: 2000 });
    expect(ruleMatches(ranged, subject({ amountCents: 1599 }))).toBe(true);
    expect(ruleMatches(ranged, subject({ amountCents: -1599 }))).toBe(true);
    expect(ruleMatches(ranged, subject({ amountCents: 2001 }))).toBe(false);
    expect(ruleMatches(ranged, subject({ amountCents: 999 }))).toBe(false);
  });

  it("does not match a ranged rule while the amount is still empty", () => {
    expect(ruleMatches(rule({ minAmountCents: 1 }), subject({ amountCents: null }))).toBe(false);
    expect(ruleMatches(rule(), subject({ amountCents: null }))).toBe(true);
  });

  it("honours type, account and enabled", () => {
    expect(ruleMatches(rule({ transactionType: "INCOME" }), subject())).toBe(false);
    expect(ruleMatches(rule({ transactionType: "EXPENSE" }), subject())).toBe(true);
    expect(ruleMatches(rule({ matchAccountId: "acc2" }), subject())).toBe(false);
    expect(ruleMatches(rule({ matchAccountId: "acc1" }), subject())).toBe(true);
    expect(ruleMatches(rule({ enabled: false }), subject())).toBe(false);
  });
});

describe("resolveRuleOutcome", () => {
  it("fills each field from the highest-priority matching rule that sets it", () => {
    const rules = [
      rule({ id: "late", priority: 5, setCategoryId: "shopping", setTitle: "Late title", appendNote: "note" }),
      rule({ id: "early", priority: 1, setCategoryId: "subs", setAccountId: "acc9" }),
      rule({ id: "unrelated", priority: 0, titlePattern: "spotify", setCategoryId: "shopping" }),
    ];
    const outcome = resolveRuleOutcome(rules, subject(), kinds);
    expect(outcome).toMatchObject({
      categoryId: "subs",
      categoryFrom: "rule",
      accountId: "acc9",
      title: "Late title",
      appendNote: "note",
      ruleIds: ["early", "late"],
    });
    expect(outcome.amountCents).toBeUndefined();
  });

  it("skips a category whose kind does not match the transaction type", () => {
    const outcome = resolveRuleOutcome([rule({ setCategoryId: "salary", setTitle: "Netflix" })], subject(), kinds);
    expect(outcome.categoryId).toBeUndefined();
    expect(outcome.title).toBe("Netflix");
  });

  it("prefers a rule over a learned combo, and falls back to the learned one", () => {
    const learned = { learned: [{ title: "netflix.com 866-579", categoryId: "shopping" }], hiddenTitleKeys: [] };
    expect(resolveRuleOutcome([rule({ setCategoryId: "subs" })], subject(), kinds, learned)).toMatchObject({
      categoryId: "subs",
      categoryFrom: "rule",
    });
    expect(resolveRuleOutcome([rule({ setTitle: "Netflix" })], subject(), kinds, learned)).toMatchObject({
      categoryId: "shopping",
      categoryFrom: "learned",
      title: "Netflix",
    });
  });

  it("ignores hidden learned combos and never applies learned categories to income", () => {
    const learned = { learned: [{ title: "Netflix.com 866-579", categoryId: "shopping" }], hiddenTitleKeys: ["netflix.com 866-579"] };
    expect(resolveRuleOutcome([], subject(), kinds, learned).categoryId).toBeUndefined();
    const visible = { learned: learned.learned, hiddenTitleKeys: [] };
    expect(resolveRuleOutcome([], subject({ type: "INCOME" }), kinds, visible).categoryId).toBeUndefined();
  });

  it("ignores disabled rules", () => {
    expect(resolveRuleOutcome([rule({ enabled: false, setCategoryId: "subs" })], subject(), kinds).ruleIds).toEqual([]);
  });
});

describe("visibleLearnedSuggestions", () => {
  it("drops hidden titles by normalised key", () => {
    const learned = [
      { title: "Coffee", categoryId: "a" },
      { title: "Rent", categoryId: "b" },
    ];
    expect(visibleLearnedSuggestions(learned, ["coffee"])).toEqual([{ title: "Rent", categoryId: "b" }]);
  });
});

describe("appendRuleNote", () => {
  it("appends once and never duplicates", () => {
    expect(appendRuleNote(null, "tax")).toBe("tax");
    expect(appendRuleNote("paid", "tax")).toBe("paid\ntax");
    expect(appendRuleNote("paid\ntax", "tax")).toBe("paid\ntax");
    expect(appendRuleNote("", undefined)).toBeNull();
  });
});

describe("planRuleApplication", () => {
  const rows = [
    { id: "t1", title: "NETFLIX.COM", type: "EXPENSE" as const, amountCents: 1599, accountId: "acc1", categoryId: "shopping", note: null },
    { id: "t2", title: "Netflix", type: "EXPENSE" as const, amountCents: 1599, accountId: "acc1", categoryId: "subs", note: null },
    { id: "t3", title: "Groceries", type: "EXPENSE" as const, amountCents: 5000, accountId: "acc1", categoryId: "shopping", note: null },
  ];

  it("lists only rows the rule matches and would change, and never touches the amount", () => {
    const changes = planRuleApplication(
      rule({ setCategoryId: "subs", setTitle: "Netflix", setAmountCents: 999 }),
      rows,
      kinds,
    );
    expect(changes).toEqual([
      {
        id: "t1",
        before: { title: "NETFLIX.COM", categoryId: "shopping", accountId: "acc1", note: null },
        after: { title: "Netflix", categoryId: "subs", accountId: "acc1", note: null },
      },
    ]);
    expect(changes[0].after).not.toHaveProperty("amountCents");
  });

  it("applies even when the rule is currently disabled (an explicit request)", () => {
    expect(planRuleApplication(rule({ enabled: false, setCategoryId: "subs" }), rows, kinds).map((c) => c.id)).toEqual(["t1"]);
  });
});
