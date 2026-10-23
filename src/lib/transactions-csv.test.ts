import { describe, expect, it } from "vitest";
import { transactionsCsv, type CsvTransaction } from "./transactions-csv";

const base: CsvTransaction = {
  date: new Date("2026-09-10T00:00:00Z"),
  postedDate: null,
  type: "EXPENSE",
  title: "Dinner",
  amountCents: 6_000,
  categoryName: "Food",
  accountName: "Visa",
  accountCurrency: "CAD",
  transferAccountName: null,
  splitParts: [],
  owedCents: 0,
  tagNames: [],
  note: null,
  verifiedBy: null,
};

function rows(txs: CsvTransaction[]) {
  return transactionsCsv(txs, "CAD").split("\r\n").map((line) => line.split(","));
}

describe("transactionsCsv", () => {
  it("puts spending in Out and income and refunds in In, always positive", () => {
    const [header, expense, income, refund, transferIn] = rows([
      base,
      { ...base, type: "INCOME", title: "Pay", amountCents: 250_000, categoryName: "Salary" },
      { ...base, title: "Return", amountCents: -1_500 },
      { ...base, type: "TRANSFER", title: "From chequing", amountCents: -20_000, transferAccountName: "Chequing" },
    ]);
    const out = header.indexOf("Out");
    const into = header.indexOf("In");
    expect([expense[out], expense[into]]).toEqual(["60.00", ""]);
    expect([income[out], income[into]]).toEqual(["", "2500.00"]);
    expect([refund[out], refund[into]]).toEqual(["", "15.00"]);
    expect([transferIn[out], transferIn[into]]).toEqual(["", "200.00"]);
    expect(transferIn[header.indexOf("Other account")]).toBe("Chequing");
  });

  it("lists split parts, owed shares, tags and the verifying bank", () => {
    const text = transactionsCsv(
      [
        {
          ...base,
          postedDate: new Date("2026-09-11T00:00:00Z"),
          splitParts: [
            { categoryName: "Food", amountCents: 4_000 },
            { categoryName: "Fun", amountCents: 2_000 },
          ],
          owedCents: 3_000,
          tagNames: ["Trip", "Work"],
          note: "With Sam, at 7",
          verifiedBy: "RBC",
        },
      ],
      "CAD",
    );
    expect(text.split("\r\n")[1]).toBe(
      '2026-09-10,2026-09-11,Expense,Dinner,60.00,,CAD,Food,Visa,,Food 40.00; Fun 20.00,30.00,Trip; Work,"With Sam, at 7",RBC',
    );
  });

  it("uses the home currency for an entry with no account, and defuses formula-like titles", () => {
    const [header, row] = rows([{ ...base, accountName: null, accountCurrency: null, title: "=HYPERLINK()" }]);
    expect(row[header.indexOf("Currency")]).toBe("CAD");
    expect(row[header.indexOf("Title")]).toBe("'=HYPERLINK()");
  });
});
