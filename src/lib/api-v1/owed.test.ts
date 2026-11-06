import { describe, expect, it } from "vitest";
import { parsePaidBody, serializeOwedToYou } from "./owed";

function share(overrides: { name: string; amountCents: number; paidAt?: Date | null; title?: string | null; currency?: string }) {
  return {
    id: overrides.name,
    userId: "u1",
    transactionId: `t-${overrides.name}`,
    name: overrides.name,
    amountCents: overrides.amountCents,
    paidAt: overrides.paidAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    transaction: {
      id: `t-${overrides.name}`,
      title: overrides.title === undefined ? "Dinner" : overrides.title,
      date: new Date(Date.UTC(2026, 10, 2)),
      category: { name: "Restaurants" },
      account: { currency: overrides.currency ?? "CAD" },
    },
  };
}

describe("serializeOwedToYou", () => {
  it("totals only what is still outstanding in the home currency, and names the expense", () => {
    const out = serializeOwedToYou(
      [
        share({ name: "Sam", amountCents: 3_000 }),
        share({ name: "Alex", amountCents: 2_000, paidAt: new Date("2026-11-04T12:00:00Z") }),
        share({ name: "Jo", amountCents: 5_000, currency: "USD" }),
        share({ name: "Kim", amountCents: 1_000, title: "  " }),
      ],
      "CAD",
    );
    expect(out.outstandingCents).toBe(4_000);
    expect(out.items.map((i) => [i.name, i.expenseLabel, i.expenseDate, i.paidAt])).toEqual([
      ["Sam", "Dinner", "2026-11-02", null],
      ["Alex", "Dinner", "2026-11-02", "2026-11-04T12:00:00.000Z"],
      ["Jo", "Dinner", "2026-11-02", null],
      ["Kim", "Restaurants", "2026-11-02", null],
    ]);
  });
});

describe("parsePaidBody", () => {
  it("takes a boolean and nothing else", () => {
    expect(parsePaidBody({ paid: true })).toEqual({ ok: true, paid: true });
    expect(parsePaidBody({ paid: "true" }).ok).toBe(false);
    expect(parsePaidBody({ paid: false, extra: 1 }).ok).toBe(false);
  });
});
