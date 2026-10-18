import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { suggestImprovements } = await import("./improvements");
const { moneyFormatter } = await import("./util");
import type { InsightBudget, InsightTx } from "./types";

const fmt = moneyFormatter();
const run = (txs: InsightTx[], budgets: InsightBudget[] = [], toSavingsByMonth: Map<string, number> | null = null) =>
  suggestImprovements({ txs, budgets, now: NOW, fmt, toSavingsByMonth });
const salary = (d: string, amount: number) => tx(d, "Payroll", amount, { type: "INCOME", categoryId: "s", categoryName: "Salary" });

describe("suggestImprovements", () => {
  const months = ["2026-06", "2026-07", "2026-08"];

  it("warns when spending outruns income, ignoring money moved to savings", () => {
    const txs = months.flatMap((m) => [
      salary(`${m}-01`, 300000),
      tx(`${m}-02`, "Rent", 320000, { categoryId: "r", categoryName: "Rent" }),
    ]);
    expect(run(txs).find((i) => i.key === "improve:savings-rate:2026-08")?.severity).toBe("high");

    const saving = months.flatMap((m) => [
      salary(`${m}-01`, 300000),
      tx(`${m}-02`, "Rent", 150000, { categoryId: "r", categoryName: "Rent" }),
      tx(`${m}-03`, "To TFSA", 140000, { categoryId: "i", categoryName: "Investment/Savings" }),
    ]);
    expect(run(saving).some((i) => i.key.startsWith("improve:savings-rate"))).toBe(false);
  });

  it("flags a category well above its recent average", () => {
    const txs = [
      ...["2026-05", "2026-06", "2026-07"].map((m) => tx(`${m}-10`, "Store", 20000)),
      tx("2026-08-10", "Store", 40000),
    ];
    const rising = run(txs).find((i) => i.key.startsWith("improve:rising"));
    expect(rising?.key).toBe("improve:rising:cat-fun:2026-08");
    expect(rising?.title).toBe("Fun was up 100% last month");
  });

  it("suggests a budget for steady, variable, unbudgeted spend only", () => {
    const txs = months.map((m, i) => tx(`${m}-10`, "Store", 10000 + i * 3000));
    expect(run(txs).some((i) => i.key === "improve:budget:cat-fun")).toBe(true);
    expect(run(txs, [{ categoryId: "cat-fun", periodMonth: "2026-01" }]).some((i) => i.key.startsWith("improve:budget"))).toBe(false);
    const fixed = months.map((m) => tx(`${m}-10`, "Phone", 10000));
    expect(run(fixed).some((i) => i.key.startsWith("improve:budget"))).toBe(false);
  });

  it("points out a crowded catch-all category", () => {
    const txs = Array.from({ length: 12 }, (_, i) =>
      tx(`2026-09-${String(i + 1).padStart(2, "0")}`, `Thing ${i}`, 1000, i < 6 ? { categoryName: "Other" } : {}),
    );
    expect(run(txs).some((i) => i.key === "improve:uncategorized")).toBe(true);
  });

  describe("with a short history", () => {
    it("does not read steady spending as rising when logging began mid-month", () => {
      // Started 15 July: the same rent every month used to come out as "Rent is up 200%",
      // because July was averaged with two months that had nothing logged.
      const txs = [
        tx("2026-07-15", "Rent", 150000, { categoryId: "r", categoryName: "Rent" }),
        tx("2026-08-15", "Rent", 150000, { categoryId: "r", categoryName: "Rent" }),
      ];
      expect(run(txs).some((i) => i.key.startsWith("improve:rising"))).toBe(false);
    });

    it("averages only the months that were fully logged", () => {
      // Logging began 10 May, so June and July are the comparison; May is left out.
      const txs = [
        tx("2026-05-10", "Store", 1000),
        ...["2026-06", "2026-07"].map((m) => tx(`${m}-10`, "Store", 20000)),
        tx("2026-08-10", "Store", 30000),
      ];
      const rising = run(txs).find((i) => i.key.startsWith("improve:rising"));
      expect(rising?.title).toBe("Fun was up 50% last month");
      expect(rising?.body).toContain("over the two months before");
    });

    it("leaves the savings rate alone until two full months are logged", () => {
      const txs = [
        salary("2026-07-20", 300000),
        tx("2026-07-25", "Rent", 320000, { categoryId: "r", categoryName: "Rent" }),
        salary("2026-08-01", 300000),
        tx("2026-08-02", "Rent", 320000, { categoryId: "r", categoryName: "Rent" }),
      ];
      expect(run(txs).some((i) => i.key.startsWith("improve:savings-rate"))).toBe(false);
    });
  });

  describe("with accounts marked Counts as savings", () => {
    const months = ["2026-06", "2026-07", "2026-08"];
    // $4,000 in, $3,800 spent: 5% left over, but $800 a month moved to a TFSA.
    const txs = months.flatMap((m) => [
      salary(`${m}-01`, 400000),
      tx(`${m}-02`, "Rent", 380000, { categoryId: "r", categoryName: "Rent" }),
    ]);

    it("measures the savings rate by transfers, as the financial score does", () => {
      const saved = new Map(months.map((m) => [m, 80000]));
      // Without accounts marked this is "About 5% of income left over".
      expect(run(txs).find((i) => i.key.startsWith("improve:savings-rate"))?.title).toBe("About 5% of income left over");
      // 20% moved to savings: nothing to suggest, in agreement with the score's 20%.
      expect(run(txs, [], saved).some((i) => i.key.startsWith("improve:savings-rate"))).toBe(false);
    });

    it("suggests moving more when little went into savings", () => {
      const saved = new Map(months.map((m) => [m, 20000]));
      const rate = run(txs, [], saved).find((i) => i.key.startsWith("improve:savings-rate"));
      expect(rate?.title).toBe("About 5% of income moved to savings");
      expect(rate?.body).toContain("went into your savings accounts");
      expect(rate?.monthlyCents).toBe(20000);
    });

    it("no longer sets aside a category named like savings", () => {
      // The transfers are the measure now; a "TFSA" expense counts as spending, as in the score.
      const withTfsa = [...txs, ...months.map((m) => tx(`${m}-05`, "To TFSA", 50000, { categoryId: "t", categoryName: "TFSA" }))];
      const saved = new Map(months.map((m) => [m, 80000]));
      expect(run(withTfsa, [], saved).find((i) => i.key.startsWith("improve:savings-rate"))?.title).toBe(
        "Spending ran ahead of income",
      );
    });
  });
});
