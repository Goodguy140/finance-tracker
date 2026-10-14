import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import {
  amountsByMonthAndCategory,
  budgetSheetRows,
  findTemplate,
  parseTemplateFormat,
  parseTemplateMode,
  resolveTemplateMonth,
  templateCsv,
  TEMPLATES,
  type TemplateSheet,
} from "./templates";
import { renderTemplatePdf } from "./templates-pdf";
import { pdfPageTexts } from "./test-pdf-text";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("template parameters", () => {
  it("falls back to safe defaults", () => {
    expect(findTemplate("budget")?.title).toBe("Monthly budget worksheet");
    expect(findTemplate("nope")).toBeNull();
    expect(parseTemplateMode("blank")).toBe("blank");
    expect(parseTemplateMode("anything")).toBe("filled");
    expect(parseTemplateFormat("csv")).toBe("csv");
    expect(parseTemplateFormat(null)).toBe("pdf");
  });

  it("allows this month or next, nothing else", () => {
    expect(resolveTemplateMonth("2026-11", "2026-10")).toBe("2026-11");
    expect(resolveTemplateMonth("2026-12", "2026-10")).toBe("2026-10");
    expect(resolveTemplateMonth("2026-09", "2026-10")).toBe("2026-10");
    expect(resolveTemplateMonth("2027-01", "2026-12")).toBe("2027-01");
    expect(resolveTemplateMonth(undefined, "2026-10")).toBe("2026-10");
  });
});

describe("budget worksheet rows", () => {
  const txs = [
    tx("2026-07-03", "Grocer", 30_000, { categoryId: "groc", categoryName: "Groceries" }),
    tx("2026-09-03", "Grocer", 45_000, { categoryId: "groc", categoryName: "Groceries" }),
    // A refund reduces its category.
    tx("2026-09-04", "Grocer refund", -5_000, { categoryId: "groc", categoryName: "Groceries" }),
    // A split counts in each part's category, not the parent's.
    tx("2026-09-10", "Costco", 20_000, {
      categoryId: "groc",
      categoryName: "Groceries",
      splits: [
        { categoryId: "groc", categoryName: "Groceries", amountCents: 15_000 },
        { categoryId: "home", categoryName: "Home", amountCents: 5_000 },
      ],
    }),
    tx("2026-08-01", "Pay", 300_000, { type: "INCOME", categoryId: "pay", categoryName: "Salary" }),
    // Outside the three months: ignored.
    tx("2026-06-01", "Grocer", 99_999, { categoryId: "groc", categoryName: "Groceries" }),
    tx("2026-10-01", "Grocer", 99_999, { categoryId: "groc", categoryName: "Groceries" }),
  ];
  const previous = ["2026-07", "2026-08", "2026-09"];

  it("sums each month by category, splits and refunds included", () => {
    const { income, expense } = amountsByMonthAndCategory(txs, previous);
    expect(expense.get("2026-09|groc")).toBe(55_000);
    expect(expense.get("2026-09|home")).toBe(5_000);
    expect(expense.get("2026-07|groc")).toBe(30_000);
    expect(expense.has("2026-06|groc")).toBe(false);
    expect(expense.has("2026-10|groc")).toBe(false);
    expect(income.get("2026-08|pay")).toBe(300_000);
  });

  it("gives every category a row, with last month, average and the plan", () => {
    const { expense } = amountsByMonthAndCategory(txs, previous);
    const rows = budgetSheetRows(
      [
        { id: "unused", name: "Aardvark care" },
        { id: "home", name: "Home" },
        { id: "groc", name: "Groceries" },
      ],
      expense,
      previous,
      new Map([["groc", { cents: 60_000, carryCents: 5_000 }]]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Groceries", "Home", "Aardvark care"]);
    expect(rows[0]).toEqual({ name: "Groceries", plannedCents: 60_000, carryCents: 5_000, lastMonthCents: 55_000, averageCents: 28_333 });
    expect(rows[1]).toMatchObject({ plannedCents: null, lastMonthCents: 5_000, averageCents: 1_667 });
    expect(rows[2]).toMatchObject({ plannedCents: null, lastMonthCents: 0, averageCents: 0 });
  });
});

const filledSheets: TemplateSheet[] = [
  {
    id: "budget",
    sheet: {
      mode: "filled",
      ym: "2026-11",
      historyMonths: ["2026-07", "2026-08", "2026-09"],
      currency: "CAD",
      income: [{ name: "Salary", plannedCents: 500_000, carryCents: 0, lastMonthCents: 480_000, averageCents: 490_000 }],
      expenses: [{ name: "Groceries", plannedCents: 60_000, carryCents: 5_000, lastMonthCents: 55_000, averageCents: 52_000 }],
    },
  },
  {
    id: "bills",
    sheet: {
      mode: "filled",
      ym: "2026-11",
      currency: "CAD",
      items: [
        { date: d("2026-11-05"), name: "Internet", type: "EXPENSE", amountCents: 8_500, accountName: "Chequing", paidOn: null },
        { date: d("2026-11-01"), name: "Rent", type: "EXPENSE", amountCents: 175_000, accountName: "Chequing", paidOn: d("2026-11-02") },
      ],
    },
  },
  {
    id: "goals",
    sheet: {
      mode: "filled",
      currency: "CAD",
      startYm: "2026-10",
      goals: [
        {
          name: "Emergency fund",
          currency: "CAD",
          targetCents: 1_000_000,
          savedCents: 250_000,
          remainingCents: 750_000,
          targetYmd: "2027-10-01",
          monthlyNeededCents: 62_500,
          accountName: "High-interest savings",
        },
      ],
    },
  },
  {
    id: "debt",
    sheet: {
      mode: "filled",
      currency: "CAD",
      startYm: "2026-10",
      debts: [{ name: "Rewards Visa", typeLabel: "Credit card", currency: "CAD", balanceCents: 123_456, asOf: d("2026-10-12") }],
    },
  },
  {
    id: "net-worth",
    sheet: {
      mode: "filled",
      currency: "CAD",
      assets: [{ name: "Chequing", typeLabel: "Chequing", currency: "CAD", balanceCents: 500_000, asOf: d("2026-10-12") }],
      liabilities: [{ name: "Rewards Visa", typeLabel: "Credit card", currency: "CAD", balanceCents: 123_456, asOf: d("2026-10-12") }],
    },
  },
];

/** What each filled sheet's own figures look like on paper and in a spreadsheet. */
const expected: Record<TemplateSheet["id"], { pdf: string[]; csv: string[] }> = {
  budget: {
    pdf: ["November 2026", "Sep 2026", "Salary", "$5,000.00", "$600.00*", "$520.00", "From Jul 2026 to Sep 2026 you averaged $4,900.00 income"],
    csv: ["Month,Section,Name,Budget or expected,2026-09,", "2026-11,Spending,Groceries,600.00,550.00,520.00,,,"],
  },
  bills: {
    pdf: ["November 2026", "$85.00 Internet", "Internet", "2 bills", "Nov 2, 2026"],
    csv: ["2026-11-05,Internet,Bill,85.00,Chequing,\r\n", "2026-11-01,Rent,Bill,1750.00,Chequing,2026-11-02"],
  },
  goals: { pdf: ["Emergency fund", "$10,000.00", "$625.00", "Start: $2,500.00", "Oct 2026", "Sep 2027"], csv: ["Emergency fund,10000.00,2027-10-01,2500.00,2026-10,625.00,,"] },
  debt: { pdf: ["Rewards Visa", "$1,234.56", "Oct 12, 2026", "Total owed"], csv: ["Rewards Visa,Credit card,1234.56,2026-10-12,,,,"] },
  "net-worth": { pdf: ["Chequing", "$5,000.00", "Rewards Visa", "$3,765.44"], csv: ["Asset,Chequing,Chequing,CAD,5000.00,2026-10-12,", "Owed,Rewards Visa,Credit card,CAD,1234.56,2026-10-12,"] },
};

describe("templates", () => {
  it("covers every template in the catalogue", () => {
    expect(filledSheets.map((s) => s.id).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  for (const sheet of filledSheets) {
    it(`prints the ${sheet.id} template with the user's figures`, async () => {
      const text = (await pdfPageTexts(await renderTemplatePdf(sheet, { todayYmd: "2026-10-14" }))).join("\n");
      for (const s of expected[sheet.id].pdf) expect(text, s).toContain(s);
    });

    it(`writes the ${sheet.id} template as a CSV with the same figures`, () => {
      const csv = templateCsv(sheet);
      for (const s of expected[sheet.id].csv) expect(csv, s).toContain(s);
      expect(csv.split("\r\n").length).toBeGreaterThan(2);
    });
  }

  it("prints blank sheets with none of those figures", async () => {
    const blanks: TemplateSheet[] = [
      { id: "budget", sheet: { mode: "blank", ym: "2026-11", historyMonths: ["2026-07", "2026-08", "2026-09"], currency: "CAD", income: [], expenses: [] } },
      { id: "bills", sheet: { mode: "blank", ym: "2026-11", currency: "CAD", items: [] } },
      { id: "goals", sheet: { mode: "blank", currency: "CAD", startYm: "2026-10", goals: [] } },
      { id: "debt", sheet: { mode: "blank", currency: "CAD", startYm: "2026-10", debts: [] } },
      { id: "net-worth", sheet: { mode: "blank", currency: "CAD", assets: [], liabilities: [] } },
    ];
    for (const sheet of blanks) {
      const text = (await pdfPageTexts(await renderTemplatePdf(sheet, { todayYmd: "2026-10-14" }))).join("\n");
      expect(text, sheet.id).toContain(findTemplate(sheet.id)!.title);
      expect(text, sheet.id).not.toMatch(/\$\d/);
      expect(text, sheet.id).not.toContain("filled in from your data");
      expect(templateCsv(sheet), sheet.id).not.toMatch(/\d+\.\d\d/);
    }
  });
});

describe("fitting a template to the page", () => {
  const categories = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Category ${i + 1}`, plannedCents: 10_000, carryCents: 0, lastMonthCents: 9_000, averageCents: 9_500 }));
  const budgetSheet = (n: number): TemplateSheet => ({
    id: "budget",
    sheet: { mode: "filled", ym: "2026-11", historyMonths: ["2026-07", "2026-08", "2026-09"], currency: "CAD", income: categories(4), expenses: categories(n) },
  });
  const pages = async (t: TemplateSheet, extraRows?: number) =>
    (await pdfPageTexts(await renderTemplatePdf(t, { todayYmd: "2026-10-14", extraRows }))).length;

  it("tightens a sheet that would run just past one page onto one", async () => {
    // Ten categories and four income sources overflow at the roomiest rows.
    expect(await pages(budgetSheet(10))).toBe(1);
    for (const id of ["bills", "goals", "debt", "net-worth"] as const) {
      const blank = {
        bills: { id, sheet: { mode: "blank", ym: "2026-11", currency: "CAD", items: [] } },
        goals: { id, sheet: { mode: "blank", currency: "CAD", startYm: "2026-10", goals: [] } },
        debt: { id, sheet: { mode: "blank", currency: "CAD", startYm: "2026-10", debts: [] } },
        "net-worth": { id, sheet: { mode: "blank", currency: "CAD", assets: [], liabilities: [] } },
      }[id] as TemplateSheet;
      expect(await pages(blank), id).toBe(1);
    }
  });

  it("lets a sheet that cannot fit run on, and honours the rows asked for", async () => {
    expect(await pages(budgetSheet(60))).toBeGreaterThan(1);
    const csvRows = (extra: number) => templateCsv(budgetSheet(10), extra).split("\r\n").length;
    expect(csvRows(12) - csvRows(0)).toBe(24); // twelve more under income and under spending
    expect(await pages(budgetSheet(10), 0)).toBe(1);
  });
});
