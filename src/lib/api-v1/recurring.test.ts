import { describe, expect, it } from "vitest";
import { dateFromYmd } from "@/lib/date-only";
import { parsePostBody, parseSkipBody, serializeRecurringRule } from "./recurring";

function rule(overrides: Partial<Parameters<typeof serializeRecurringRule>[0]> = {}) {
  return {
    id: "r1",
    name: "Rent",
    type: "EXPENSE" as const,
    amountCents: 150_000,
    cadence: "MONTHLY" as const,
    nextExpectedDate: dateFromYmd("2026-11-01"),
    endDate: null,
    postMode: "REVIEW" as const,
    account: { name: "Chequing", currency: "CAD" },
    transferAccount: null,
    category: { name: "Housing" },
    ...overrides,
  };
}

describe("serializeRecurringRule", () => {
  it("says whether the waiting occurrence is overdue, due today or upcoming in the user's day", () => {
    expect(serializeRecurringRule(rule(), "2026-11-03").status).toBe("overdue");
    expect(serializeRecurringRule(rule(), "2026-11-01").status).toBe("due");
    expect(serializeRecurringRule(rule(), "2026-10-31").status).toBe("upcoming");
  });

  it("gives a bill its category and account, and the date Post and Skip act on", () => {
    expect(serializeRecurringRule(rule(), "2026-11-03")).toMatchObject({
      type: "expense",
      cadence: "monthly",
      date: "2026-11-01",
      account: "Chequing",
      toAccount: null,
      category: "Housing",
      currency: "CAD",
      autoPost: false,
    });
  });

  it("gives a transfer both accounts and no category", () => {
    const transfer = serializeRecurringRule(
      rule({ type: "TRANSFER", transferAccount: { name: "Savings" }, postMode: "AUTO" }),
      "2026-11-03",
    );
    expect(transfer).toMatchObject({ type: "transfer", account: "Chequing", toAccount: "Savings", category: null, autoPost: true });
  });
});

describe("parsePostBody and parseSkipBody", () => {
  it("take a calendar date", () => {
    expect(parsePostBody({ expectedDate: "2026-11-01" })).toEqual({ ok: true, value: { expectedDate: "2026-11-01" } });
    expect(parsePostBody({ expectedDate: "2026-02-30" }).ok).toBe(false);
    expect(parsePostBody({ expectedDate: "Nov 1" }).ok).toBe(false);
    expect(parsePostBody({}).ok).toBe(false);
  });

  it("skip once unless told the person already logged it", () => {
    expect(parseSkipBody({ expectedDate: "2026-11-01" })).toEqual({
      ok: true,
      value: { expectedDate: "2026-11-01", reason: "skip_once" },
    });
    expect(parseSkipBody({ expectedDate: "2026-11-01", reason: "already_logged" })).toMatchObject({
      ok: true,
      value: { reason: "already_logged" },
    });
    expect(parseSkipBody({ expectedDate: "2026-11-01", reason: "canceled" }).ok).toBe(false);
  });
});
