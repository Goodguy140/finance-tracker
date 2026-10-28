import { describe, expect, it } from "vitest";
import {
  appendRuleNote,
  describeRuleCondition,
  joinRuleTitlePatterns,
  planRuleApplication,
  resolveRuleOutcome,
  ruleMatches,
  splitCentsByShares,
  ruleTitlePatterns,
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
    addTagId: null,
    markAsTransfer: false,
    setTransferAccountId: null,
    splitBy: [],
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

  it("matches if any of the rule's texts does, for every operator", () => {
    const either = "Bell Aliant Pap\nInternet";
    expect(ruleMatches(rule({ titlePattern: either }), subject({ texts: ["BELL ALIANT PAP 1234"] }))).toBe(true);
    expect(ruleMatches(rule({ titlePattern: either }), subject({ texts: ["Eastlink Internet"] }))).toBe(true);
    expect(ruleMatches(rule({ titlePattern: either }), subject({ texts: ["Bell Mobility"] }))).toBe(false);
    expect(ruleMatches(rule({ titleOperator: "EQUALS", titlePattern: "costco\nlcbo" }), subject({ texts: ["LCBO"] }))).toBe(true);
    expect(ruleMatches(rule({ titleOperator: "STARTS_WITH", titlePattern: "x\nsq *" }), subject({ texts: ["SQ *CAFE"] }))).toBe(true);
    // A blank line is not an empty pattern that matches everything.
    expect(ruleMatches(rule({ titlePattern: "costco\n\n" }), subject({ texts: ["Netflix"] }))).toBe(false);
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

  it("adds every matching rule's tag, not only the first, without repeats", () => {
    const rules = [
      rule({ id: "a", priority: 0, addTagId: "tag-subs" }),
      rule({ id: "b", priority: 1, addTagId: "tag-tax" }),
      rule({ id: "c", priority: 2, addTagId: "tag-subs" }),
      rule({ id: "d", priority: 3, titlePattern: "spotify", addTagId: "tag-music" }),
    ];
    const outcome = resolveRuleOutcome(rules, subject(), kinds);
    expect(outcome.tagIds).toEqual(["tag-subs", "tag-tax"]);
    expect(outcome.ruleIds).toEqual(["a", "b"]);
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
    { id: "t1", title: "NETFLIX.COM", type: "EXPENSE" as const, amountCents: 1599, accountId: "acc1", categoryId: "shopping", note: null, tagIds: [] },
    { id: "t2", title: "Netflix", type: "EXPENSE" as const, amountCents: 1599, accountId: "acc1", categoryId: "subs", note: null, tagIds: [] },
    { id: "t3", title: "Groceries", type: "EXPENSE" as const, amountCents: 5000, accountId: "acc1", categoryId: "shopping", note: null, tagIds: [] },
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
        addTagId: null,
        markAsTransfer: false,
        transferAccountId: null,
        splitLines: null,
      },
    ]);
    expect(changes[0].after).not.toHaveProperty("amountCents");
  });

  it("applies even when the rule is currently disabled (an explicit request)", () => {
    expect(planRuleApplication(rule({ enabled: false, setCategoryId: "subs" }), rows, kinds).map((c) => c.id)).toEqual(["t1"]);
  });

  it("adds the rule's tag to matching rows that lack it, and skips rows that already have it", () => {
    const tagged = rows.map((row) => (row.id === "t2" ? { ...row, tagIds: ["tag-subs"] } : row));
    const changes = planRuleApplication(rule({ addTagId: "tag-subs" }), tagged, kinds);
    expect(changes.map((c) => [c.id, c.addTagId])).toEqual([["t1", "tag-subs"]]);
    expect(changes[0].after).toEqual(changes[0].before);
  });

  it("turns matching expenses into transfers with the rule's other account, except entries with owed shares", () => {
    const owed = [...rows, { ...rows[1], id: "t4", hasOwedShares: true }];
    const changes = planRuleApplication(
      rule({ markAsTransfer: true, setTransferAccountId: "acc-visa", setTitle: "Netflix" }),
      owed,
      kinds,
    );
    expect(changes.map((c) => [c.id, c.markAsTransfer, c.transferAccountId])).toEqual([
      ["t1", true, "acc-visa"],
      ["t2", true, "acc-visa"],
    ]);
  });

  it("does not name the row's own account as the other side", () => {
    const [change] = planRuleApplication(rule({ markAsTransfer: true, setTransferAccountId: "acc1" }), rows, kinds);
    expect(change).toMatchObject({ markAsTransfer: true, transferAccountId: null });
  });
});

describe("mark as transfer", () => {
  it("is filled by the first marking rule, with that rule's other account", () => {
    const outcome = resolveRuleOutcome(
      [
        rule({ id: "a", priority: 0, markAsTransfer: true }),
        rule({ id: "b", priority: 1, markAsTransfer: true, setTransferAccountId: "acc-visa" }),
      ],
      subject(),
      kinds,
    );
    expect(outcome).toMatchObject({ markAsTransfer: true, ruleIds: ["a"] });
    expect(outcome.transferAccountId).toBeUndefined();
  });

  it("does not fall back to a learned category for an entry a rule marks", () => {
    const outcome = resolveRuleOutcome([rule({ markAsTransfer: true })], subject(), kinds, {
      learned: [{ title: "NETFLIX.COM 866-579", categoryId: "subs" }],
      hiddenTitleKeys: [],
    });
    expect(outcome.categoryId).toBeUndefined();
  });

  it("keeps an expenses-only marking rule matching the transfer it made, by the direction of the money", () => {
    const marking = rule({ transactionType: "EXPENSE", markAsTransfer: true, setTitle: "Visa payment" });
    expect(ruleMatches(marking, subject({ type: "TRANSFER", amountCents: 50000 }))).toBe(true);
    expect(ruleMatches(marking, subject({ type: "TRANSFER", amountCents: -50000 }))).toBe(false);
    // A rule that does not mark transfers stays off transfers, as before.
    expect(ruleMatches(rule({ transactionType: "EXPENSE" }), subject({ type: "TRANSFER" }))).toBe(false);
  });
});

describe("rule title patterns", () => {
  it("drops blank lines and case-insensitive repeats, keeping the first spelling", () => {
    expect(ruleTitlePatterns(" Bell Aliant Pap \n\ninternet\nINTERNET")).toEqual(["Bell Aliant Pap", "internet"]);
    expect(joinRuleTitlePatterns(["Netflix", " ", "netflix", "Spotify "])).toBe("Netflix\nSpotify");
  });

  it("describes several texts as alternatives", () => {
    const labels = { account: (id: string) => id, amount: (cents: number) => String(cents) };
    expect(describeRuleCondition(rule({ titlePattern: "Bell Aliant Pap\nInternet" }), labels)).toBe(
      "Title contains “Bell Aliant Pap” or “Internet”",
    );
  });
});

describe("split by percentage", () => {
  const costco = [
    { categoryId: "subs", basisPoints: 7000 },
    { categoryId: "shopping", basisPoints: 3000 },
  ];

  it("cuts an amount into its shares to the cent, refunds included", () => {
    expect(splitCentsByShares(10001, costco)).toEqual([
      { categoryId: "subs", amountCents: 7001 },
      { categoryId: "shopping", amountCents: 3000 },
    ]);
    expect(splitCentsByShares(-999, costco)).toEqual([
      { categoryId: "subs", amountCents: -699 },
      { categoryId: "shopping", amountCents: -300 },
    ]);
    const thirds = [
      { categoryId: "a", basisPoints: 3333 },
      { categoryId: "b", basisPoints: 3333 },
      { categoryId: "c", basisPoints: 3334 },
    ];
    expect(splitCentsByShares(100, thirds).map((l) => l.amountCents)).toEqual([33, 33, 34]);
    // One cent cannot be shared: the line that would get nothing is left out.
    expect(splitCentsByShares(1, costco)).toEqual([{ categoryId: "subs", amountCents: 1 }]);
  });

  it("sets the split and its first category, competing with Category for the first matching rule", () => {
    const splitting = rule({ id: "split", priority: 1, splitBy: costco });
    expect(resolveRuleOutcome([splitting], subject(), kinds)).toMatchObject({
      split: costco,
      splitRuleId: "split",
      categoryId: "subs",
      categoryFrom: "rule",
      ruleIds: ["split"],
    });
    const earlier = rule({ id: "cat", priority: 0, setCategoryId: "shopping" });
    const outcome = resolveRuleOutcome([splitting, earlier], subject(), kinds);
    expect(outcome.categoryId).toBe("shopping");
    expect(outcome.split).toBeUndefined();
  });

  it("splits nothing for income, or once a line's category is gone and the rest falls short of 100%", () => {
    const splitting = rule({ splitBy: costco });
    expect(resolveRuleOutcome([splitting], subject({ type: "INCOME" }), kinds).split).toBeUndefined();
    const withoutShopping = new Map([...kinds].filter(([id]) => id !== "shopping"));
    expect(resolveRuleOutcome([splitting], subject(), withoutShopping).split).toBeUndefined();
    const short = rule({ splitBy: [costco[0]] });
    expect(resolveRuleOutcome([short], subject(), kinds).split).toBeUndefined();
  });

  it("splits matching past expenses, but not ones someone owes part of", () => {
    const rows = [
      { id: "t1", title: "Netflix", type: "EXPENSE" as const, amountCents: 2000, accountId: "acc1", categoryId: "shopping", note: null, tagIds: [] },
      { id: "t2", title: "Netflix", type: "EXPENSE" as const, amountCents: 2000, accountId: "acc1", categoryId: "shopping", note: null, tagIds: [], hasOwedShares: true },
    ];
    const changes = planRuleApplication(rule({ splitBy: costco }), rows, kinds);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: "t1",
      after: { categoryId: "subs" },
      splitLines: [
        { categoryId: "subs", amountCents: 1400 },
        { categoryId: "shopping", amountCents: 600 },
      ],
    });
  });
});
