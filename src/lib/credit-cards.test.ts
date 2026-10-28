import { describe, expect, it } from "vitest";
import { cardsDueWithin, cardUtilization, nextDueDate, parseDueDayInput, totalUtilization } from "./credit-cards";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe("card utilization", () => {
  it("is what is owed as a share of the limit, flagged over 30%", () => {
    expect(cardUtilization(150_000, 500_000)).toEqual({ pct: 30, high: false });
    expect(cardUtilization(155_000, 500_000)).toEqual({ pct: 31, high: true });
    // A card in credit uses none of its limit.
    expect(cardUtilization(-2_000, 500_000)).toEqual({ pct: 0, high: false });
    expect(cardUtilization(150_000, null)).toBeNull();
    expect(cardUtilization(null, 500_000)).toBeNull();
  });

  it("totals across cards that have both a limit and a balance", () => {
    expect(
      totalUtilization([
        { latest: { cents: 100_000 }, creditLimitCents: 200_000 },
        { latest: { cents: 0 }, creditLimitCents: 800_000 },
        { latest: { cents: 999_999 }, creditLimitCents: null },
        { latest: null, creditLimitCents: 500_000 },
      ]),
    ).toEqual({ pct: 10, high: false });
    expect(totalUtilization([{ latest: { cents: 5 }, creditLimitCents: null }])).toBeNull();
  });
});

describe("due dates", () => {
  it("is this month's day when still ahead, otherwise next month's, clamped to a short month", () => {
    expect(ymd(nextDueDate(21, "2026-10-21"))).toBe("2026-10-21");
    expect(ymd(nextDueDate(21, "2026-10-22"))).toBe("2026-11-21");
    expect(ymd(nextDueDate(31, "2027-02-10"))).toBe("2027-02-28");
    expect(ymd(nextDueDate(30, "2026-12-31"))).toBe("2027-01-30");
  });

  it("lists cards due within the window, leaving out ones that owe nothing", () => {
    const due = cardsDueWithin(
      [
        { id: "a", name: "Visa", paymentDueDay: 25, minimumPaymentCents: 1_000, owed: { cents: 40_000, date: new Date() } },
        { id: "b", name: "Amex", paymentDueDay: 28, minimumPaymentCents: null, owed: null },
        { id: "c", name: "Paid off", paymentDueDay: 24, minimumPaymentCents: null, owed: { cents: 0, date: new Date() } },
        { id: "d", name: "Later", paymentDueDay: 30, minimumPaymentCents: null, owed: null },
        { id: "e", name: "No day", paymentDueDay: null, minimumPaymentCents: null, owed: null },
      ],
      "2026-10-23",
      5,
    );
    expect(due.map((d) => [d.name, ymd(d.date), d.daysAway, d.owedCents])).toEqual([
      ["Visa", "2026-10-25", 2, 40_000],
      ["Amex", "2026-10-28", 5, null],
    ]);
  });

  it("accepts a day of the month 1 to 31, or blank", () => {
    expect(parseDueDayInput("15")).toBe(15);
    expect(parseDueDayInput(" ")).toBeNull();
    expect(parseDueDayInput("0")).toBe("invalid");
    expect(parseDueDayInput("32")).toBe("invalid");
    expect(parseDueDayInput("1.5")).toBe("invalid");
  });
});
