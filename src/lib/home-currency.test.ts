import { describe, expect, it } from "vitest";
import { describeOtherCurrencies, foreignCurrencyOf, homeCurrencyOf, sumOtherCurrencies } from "./home-currency";

describe("homeCurrencyOf", () => {
  it("is the country's currency, Canada's when unknown", () => {
    expect(homeCurrencyOf("JP")).toBe("JPY");
    expect(homeCurrencyOf("CA")).toBe("CAD");
    expect(homeCurrencyOf(null)).toBe("CAD");
  });
});

describe("foreignCurrencyOf", () => {
  it("names only a currency other than the home one", () => {
    expect(foreignCurrencyOf({ currency: "USD" }, "CAD")).toBe("USD");
    expect(foreignCurrencyOf({ currency: "CAD" }, "CAD")).toBeNull();
    // A removed account leaves nothing to say otherwise.
    expect(foreignCurrencyOf(null, "CAD")).toBeNull();
  });
});

describe("sumOtherCurrencies", () => {
  it("sums spending and income per foreign currency and skips home rows and transfers", () => {
    const totals = sumOtherCurrencies([
      { type: "EXPENSE", amountCents: 4000, currency: "USD" },
      { type: "EXPENSE", amountCents: -500, currency: "USD" },
      { type: "INCOME", amountCents: 10000, currency: "USD" },
      { type: "EXPENSE", amountCents: 900, currency: "EUR" },
      { type: "EXPENSE", amountCents: 123456, currency: null },
      { type: "TRANSFER", amountCents: 7000, currency: "USD" },
    ]);
    expect(totals).toEqual([
      { currency: "EUR", expenseCents: 900, incomeCents: 0 },
      { currency: "USD", expenseCents: 3500, incomeCents: 10000 },
    ]);
  });
});

describe("describeOtherCurrencies", () => {
  const totals = [
    { currency: "EUR", expenseCents: 900, incomeCents: 0 },
    { currency: "USD", expenseCents: 3500, incomeCents: 10000 },
  ];
  it("lists each currency with any of the kind, in its own currency", () => {
    expect(describeOtherCurrencies(totals, "expense")).toBe("€9.00 in EUR, US$35.00 in USD");
    expect(describeOtherCurrencies(totals, "income")).toBe("US$100.00 in USD");
  });
  it("is null when there is nothing to mention", () => {
    expect(describeOtherCurrencies([], "expense")).toBeNull();
    expect(describeOtherCurrencies([{ currency: "USD", expenseCents: 100, incomeCents: 0 }], "income")).toBeNull();
  });
});
