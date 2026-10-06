import { beforeEach, describe, expect, it, vi } from "vitest";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { autoPostDueRecurringTransactions, postRecurringOccurrence } = await import("./recurring-post");

type Rule = {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string;
  type: "EXPENSE" | "INCOME";
  name: string;
  amountCents: number;
  cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
  nextExpectedDate: Date;
  anchorDay?: number | null;
  endDate: Date | null;
  note: string | null;
  enabled: boolean;
  postMode: "REVIEW" | "AUTO";
  account: { archived: boolean };
  category: { kind: "EXPENSE" | "INCOME" };
};

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    userId: "u1",
    accountId: "acc-1",
    categoryId: "cat-1",
    type: "EXPENSE",
    name: "Rent",
    amountCents: 150_000,
    cadence: "MONTHLY",
    nextExpectedDate: dateFromYmd("2026-06-01"),
    endDate: null,
    note: null,
    enabled: true,
    postMode: "AUTO",
    account: { archived: false },
    category: { kind: "EXPENSE" },
    ...overrides,
  };
}

/**
 * A tiny in-memory stand-in for the two tables the poster touches, so the multi-occurrence
 * catch-up can be exercised end to end rather than one mocked call at a time.
 */
function fakeDb(initial: Rule, timezone = "UTC") {
  let current = { ...initial };
  const posted: Array<{ recurringExpectedDate: Date }> = [];
  const tx = {
    recurringTransaction: {
      findFirst: vi.fn(async () => ({ ...current })),
      updateMany: vi.fn(async ({ where, data }: { where: { nextExpectedDate: Date }; data: Partial<Rule> }) => {
        if (where.nextExpectedDate.getTime() !== current.nextExpectedDate.getTime()) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      }),
    },
    transaction: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { recurringExpectedDate: Date } }) => {
        posted.push({ recurringExpectedDate: data.recurringExpectedDate });
        return { id: `t${posted.length}` };
      }),
      update: vi.fn(),
    },
    subscriptionShareStatus: { findMany: vi.fn(async () => []) },
  };
  const client = {
    user: { findUnique: vi.fn(async () => ({ timezone })) },
    recurringTransaction: {
      findMany: vi.fn(async () => (current.enabled && current.postMode === "AUTO" ? [{ id: current.id, nextExpectedDate: current.nextExpectedDate }] : [])),
      findUnique: vi.fn(async () => ({ nextExpectedDate: current.nextExpectedDate, enabled: current.enabled })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { tx, client, posted: () => posted.map((p) => ymdFromDateUtc(p.recurringExpectedDate)), current: () => current };
}

describe("postRecurringOccurrence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the occurrence and advances the rule", async () => {
    const db = fakeDb(rule());
    const outcome = await postRecurringOccurrence(db.tx as never, {
      userId: "u1",
      recurringTransactionId: "rule-1",
      expectedDate: dateFromYmd("2026-06-01"),
    });
    expect(outcome).toBe("posted");
    expect(db.posted()).toEqual(["2026-06-01"]);
    expect(ymdFromDateUtc(db.current().nextExpectedDate)).toBe("2026-07-01");
  });

  it("posts a later occurrence of an overdue rule, passing over the missed ones", async () => {
    const db = fakeDb(rule({ nextExpectedDate: dateFromYmd("2026-04-15") }));
    const post = (ymd: string) =>
      postRecurringOccurrence(db.tx as never, {
        userId: "u1",
        recurringTransactionId: "rule-1",
        expectedDate: dateFromYmd(ymd),
      });
    expect(await post("2026-06-15")).toBe("posted");
    expect(db.posted()).toEqual(["2026-06-15"]);
    expect(ymdFromDateUtc(db.current().nextExpectedDate)).toBe("2026-07-15");
    // The passed-over occurrences are gone, and a date off the cadence was never one.
    await expect(post("2026-05-15")).rejects.toThrow("already moved");
    await expect(post("2026-07-16")).rejects.toThrow("already moved");
  });

  it("refuses a disabled rule and an archived account with a readable message", async () => {
    await expect(
      postRecurringOccurrence(fakeDb(rule({ enabled: false })).tx as never, {
        userId: "u1",
        recurringTransactionId: "rule-1",
        expectedDate: dateFromYmd("2026-06-01"),
      }),
    ).rejects.toThrow("Recurring transaction is disabled.");
    await expect(
      postRecurringOccurrence(fakeDb(rule({ account: { archived: true } })).tx as never, {
        userId: "u1",
        recurringTransactionId: "rule-1",
        expectedDate: dateFromYmd("2026-06-01"),
      }),
    ).rejects.toThrow("archived account");
  });
});

describe("autoPostDueRecurringTransactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("catches up every occurrence due on or before today", async () => {
    const db = fakeDb(rule({ nextExpectedDate: dateFromYmd("2026-04-01") }));
    const result = await autoPostDueRecurringTransactions("u1", new Date("2026-06-15T12:00:00.000Z"), db.client as never);
    expect(result).toEqual({ posted: 3, ruleIds: ["rule-1"] });
    expect(db.posted()).toEqual(["2026-04-01", "2026-05-01", "2026-06-01"]);
    expect(ymdFromDateUtc(db.current().nextExpectedDate)).toBe("2026-07-01");
  });

  it("keeps a rule on the 31st on the last day of every month after February", async () => {
    // Saved before anchorDay existed: the first post stores the 31st before it clamps to Feb 28.
    const db = fakeDb(rule({ nextExpectedDate: dateFromYmd("2026-01-31"), anchorDay: null }));
    await autoPostDueRecurringTransactions("u1", new Date("2026-04-30T12:00:00.000Z"), db.client as never);
    expect(db.posted()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(ymdFromDateUtc(db.current().nextExpectedDate)).toBe("2026-05-31");
    expect(db.current().anchorDay).toBe(31);
  });

  it("decides 'today' in the user's time zone", async () => {
    // 2026-06-01 03:00Z is still May 31 in Toronto but already June 1 in Tokyo.
    const instant = new Date("2026-06-01T03:00:00.000Z");
    const toronto = fakeDb(rule(), "America/Toronto");
    expect((await autoPostDueRecurringTransactions("u1", instant, toronto.client as never)).posted).toBe(0);
    const tokyo = fakeDb(rule(), "Asia/Tokyo");
    expect((await autoPostDueRecurringTransactions("u1", instant, tokyo.client as never)).posted).toBe(1);
  });

  it("stops at the end date and leaves a broken rule alone instead of failing the sweep", async () => {
    const ending = fakeDb(rule({ nextExpectedDate: dateFromYmd("2026-05-01"), endDate: dateFromYmd("2026-05-15") }));
    const result = await autoPostDueRecurringTransactions("u1", new Date("2026-08-01T12:00:00.000Z"), ending.client as never);
    expect(result.posted).toBe(1);
    expect(ending.current().enabled).toBe(false);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = fakeDb(rule({ account: { archived: true } }));
    const outcome = await autoPostDueRecurringTransactions("u1", new Date("2026-08-01T12:00:00.000Z"), broken.client as never);
    expect(outcome.posted).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores rules that are in review mode", async () => {
    const db = fakeDb(rule({ postMode: "REVIEW", nextExpectedDate: dateFromYmd("2026-01-01") }));
    expect((await autoPostDueRecurringTransactions("u1", new Date("2026-06-15T12:00:00.000Z"), db.client as never)).posted).toBe(0);
    expect(db.client.$transaction).not.toHaveBeenCalled();
  });
});
