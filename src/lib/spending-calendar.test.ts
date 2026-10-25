import { describe, expect, it } from "vitest";
import { buildCalendarMonth, dayLogHref } from "./spending-calendar";

describe("buildCalendarMonth", () => {
  const month = buildCalendarMonth({
    ym: "2026-10",
    todayYmd: "2026-10-20",
    expenses: [
      { dateYmd: "2026-10-03", cents: 2_500 },
      { dateYmd: "2026-10-03", cents: 1_000 },
      { dateYmd: "2026-10-15", cents: 9_000 },
      // Outside the month: the padding days stay empty.
      { dateYmd: "2026-09-30", cents: 50_000 },
    ],
    incomes: [{ dateYmd: "2026-10-15", cents: 200_000 }],
    bills: [{ dateYmd: "2026-10-28", name: "Rent", type: "EXPENSE", cents: 150_000, overdue: false }],
  });
  const days = month.weeks.flat();
  const day = (ymd: string) => days.find((d) => d.dateYmd === ymd)!;

  it("lays the month out in whole Sunday-first weeks", () => {
    // October 2026 starts on a Thursday and has 31 days: 5 weeks.
    expect(month.weeks).toHaveLength(5);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
    expect(days[0].dateYmd).toBe("2026-09-27");
    expect(days[0].inMonth).toBe(false);
    expect(days.at(-1)?.dateYmd).toBe("2026-10-31");
  });

  it("adds up each day and the month, ignoring days outside it", () => {
    expect(day("2026-10-03")).toMatchObject({ spentCents: 3_500, count: 2 });
    expect(day("2026-10-15")).toMatchObject({ spentCents: 9_000, incomeCents: 200_000, count: 2 });
    expect(day("2026-09-30").spentCents).toBe(0);
    expect(month.spentCents).toBe(12_500);
    expect(month.incomeCents).toBe(200_000);
    expect(month.busiestYmd).toBe("2026-10-15");
  });

  it("puts bills on their day and marks today", () => {
    expect(day("2026-10-28").bills.map((b) => b.name)).toEqual(["Rent"]);
    expect(day("2026-10-20").isToday).toBe(true);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("pads the last week of a month ending mid-week", () => {
    const feb = buildCalendarMonth({ ym: "2026-02", todayYmd: "2026-10-20", expenses: [], incomes: [], bills: [] });
    expect(feb.weeks).toHaveLength(4);
    expect(feb.busiestYmd).toBeNull();
  });
});

describe("dayLogHref", () => {
  it("is a one-day custom range", () => {
    expect(dayLogHref("2026-10-03")).toBe("/?range=custom&from=2026-10-03&to=2026-10-03");
  });
});
