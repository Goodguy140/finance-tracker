import { describe, expect, it } from "vitest";
import { groupTransactionsByDay, homeCurrencyDayTotal } from "@/lib/transaction-day-groups";

const row = (id: string, dateYmd: string) => ({ id, dateYmd, dateDisplay: `display ${dateYmd}` });

describe("groupTransactionsByDay", () => {
  it("puts each day's rows under one section, newest day first as given", () => {
    const days = groupTransactionsByDay(
      [row("a", "2026-10-12"), row("b", "2026-10-12"), row("c", "2026-10-11")],
      (r) => r,
    );
    expect(days.map((d) => [d.dateYmd, d.dateDisplay, d.items.map((r) => r.id)])).toEqual([
      ["2026-10-12", "display 2026-10-12", ["a", "b"]],
      ["2026-10-11", "display 2026-10-11", ["c"]],
    ]);
  });

  it("joins an out-of-order row to its existing day instead of opening a second one", () => {
    const days = groupTransactionsByDay(
      [row("a", "2026-10-12"), row("b", "2026-10-11"), row("c", "2026-10-12")],
      (r) => r,
    );
    expect(days.map((d) => d.items.map((r) => r.id))).toEqual([["a", "c"], ["b"]]);
  });

  it("returns no sections for no rows", () => {
    expect(groupTransactionsByDay([], (r: ReturnType<typeof row>) => r)).toEqual([]);
  });
});

describe("homeCurrencyDayTotal", () => {
  it("sums home-currency rows and leaves other currencies out", () => {
    expect(
      homeCurrencyDayTotal([
        { amountCents: 1000 },
        { amountCents: 250, currency: null },
        { amountCents: 4000, currency: "USD" },
        { amountCents: -300 },
      ]),
    ).toBe(950);
  });

  it("is null when every row is in another currency", () => {
    expect(homeCurrencyDayTotal([{ amountCents: 4000, currency: "USD" }])).toBeNull();
  });
});
