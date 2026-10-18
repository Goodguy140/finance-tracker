import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { detectSavingsOpportunities, isBankFee } = await import("./savings");
const { detectRecurringCandidates } = await import("./recurring-detection");
const { moneyFormatter } = await import("./util");
import type { InsightRecurringRule, InsightTx } from "./types";

const fmt = moneyFormatter();

function run(txs: InsightTx[], rules: InsightRecurringRule[] = []) {
  const candidates = detectRecurringCandidates(txs, rules, NOW);
  return detectSavingsOpportunities({ txs, rules, candidates, now: NOW, fmt });
}

describe("detectSavingsOpportunities", () => {
  it("spots a price increase on a linked recurring rule", () => {
    const rule: InsightRecurringRule = { id: "r1", name: "Spotify", type: "EXPENSE", amountCents: 1299, cadence: "MONTHLY", enabled: true, categoryId: "c" };
    const txs = [
      tx("2026-06-02", "Spotify", 1099, { recurringTransactionId: "r1" }),
      tx("2026-07-02", "Spotify", 1099, { recurringTransactionId: "r1" }),
      tx("2026-08-02", "Spotify", 1099, { recurringTransactionId: "r1" }),
      tx("2026-09-02", "Spotify", 1299, { recurringTransactionId: "r1" }),
    ];
    const rise = run(txs, [rule]).find((i) => i.key.startsWith("saving:price-increase"));
    expect(rise?.key).toBe("saving:price-increase:r1:1299");
    expect(rise?.annualCents).toBe(200 * 12);
    // No rise, no insight.
    const flat = txs.map((t) => ({ ...t, amountCents: 1099 }));
    expect(run(flat, [rule]).some((i) => i.key.startsWith("saving:price-increase"))).toBe(false);
  });

  it("totals three or more streaming services", () => {
    const txs = [tx("2026-09-01", "Netflix", 1899), tx("2026-09-03", "Crave", 2199), tx("2026-09-05", "Spotify P0A1", 1299)];
    const streaming = run(txs).find((i) => i.key.startsWith("saving:streaming"));
    expect(streaming?.key).toBe("saving:streaming:Crave,Netflix,Spotify");
    expect(streaming?.monthlyCents).toBe(1899 + 2199 + 1299);
    expect(run(txs.slice(0, 2)).some((i) => i.key.startsWith("saving:streaming"))).toBe(false);
  });

  describe("what each idea would save", () => {
    it("counts money two ideas share once: delivery orders filed under dining", () => {
      // Every meal out is an Uber Eats order, so cooking more saves nothing the delivery idea
      // has not already counted.
      const txs = ["2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) =>
        ["03", "08", "13", "18", "23"].map((d) => tx(`${m}-${d}`, "UBER EATS", 4900, { categoryName: "Restaurants" })),
      );
      const found = run(txs);
      const delivery = found.find((i) => i.key === "saving:delivery-apps");
      const dining = found.find((i) => i.key === "saving:dining-share");
      expect(delivery?.savingCents).toBe(Math.round((delivery?.annualCents ?? 0) * 0.2));
      expect(dining?.savingCents).toBe(0);
      expect(dining?.body).toContain("on top of the ideas above");
    });

    it("saves what rotating drops, and does not count a price rise on a dropped service again", () => {
      const rule = { id: "r1", name: "Spotify", type: "EXPENSE", amountCents: 1299, cadence: "MONTHLY", enabled: true, categoryId: "c" } as const;
      const txs = [
        ...["2026-06-02", "2026-07-02", "2026-08-02"].map((d) => tx(d, "Spotify", 1099, { recurringTransactionId: "r1" })),
        tx("2026-09-02", "Spotify", 1299, { recurringTransactionId: "r1" }),
        tx("2026-09-01", "Netflix", 1899),
        tx("2026-09-03", "Crave", 2199),
      ];
      const found = run(txs, [rule]);
      // Keep the two dearest (Crave, Netflix); Spotify is the one rotated out.
      expect(found.find((i) => i.key.startsWith("saving:streaming"))?.savingCents).toBe(1299 * 12);
      const rise = found.find((i) => i.key.startsWith("saving:price-increase"));
      expect(rise?.annualCents).toBe(200 * 12);
      expect(rise?.savingCents).toBe(0);
    });

    it("leaves a one-off double charge out of the yearly total", () => {
      const txs = [tx("2026-09-10", "Best Buy", 12999), tx("2026-09-10", "Best Buy", 12999)];
      const dup = run(txs).find((i) => i.key.startsWith("saving:duplicate"));
      expect(dup).toBeDefined();
      expect(dup?.savingCents).toBeUndefined();
    });
  });

  it("flags the same amount at the same merchant twice within a day", () => {
    const a = tx("2026-09-10", "Best Buy #12", 12999);
    const b = tx("2026-09-11", "BEST BUY #12", 12999);
    const dupes = run([a, b]).filter((i) => i.key.startsWith("saving:duplicate"));
    expect(dupes).toHaveLength(1);
    expect(dupes[0].evidenceTxIds).toEqual([b.id, a.id]);
    expect(run([a, { ...b, amountCents: 12998 }]).some((i) => i.key.startsWith("saving:duplicate"))).toBe(false);
    const twoDaysLater = { ...b, date: new Date("2026-09-12T00:00:00Z") };
    expect(run([a, twoDaysLater]).some((i) => i.key.startsWith("saving:duplicate"))).toBe(false);
    const liquor = [tx("2026-09-10", "NSLC", 5990), tx("2026-09-10", "NSLC", 5990)];
    expect(run(liquor).some((i) => i.key.startsWith("saving:duplicate"))).toBe(false);
  });

  it("adds up frequent small purchases but leaves groceries alone", () => {
    const coffee = Array.from({ length: 20 }, (_, i) =>
      tx(`2026-${i < 10 ? "08" : "09"}-${String((i % 10) * 2 + 1).padStart(2, "0")}`, "Tim Hortons #1", 650),
    );
    const found = run(coffee).find((i) => i.key === "saving:frequent:tim hortons");
    expect(found).toBeDefined();
    const asGroceries = coffee.map((t) => ({ ...t, categoryName: "Groceries" }));
    expect(run(asGroceries).some((i) => i.key.startsWith("saving:frequent"))).toBe(false);
  });

  it("compares eating out with groceries over the last full months", () => {
    const months = ["2026-06", "2026-07", "2026-08"];
    const txs = months.flatMap((m) => [
      tx(`${m}-05`, "Restaurant", 30000, { categoryId: "d", categoryName: "Delivery/Eating out" }),
      tx(`${m}-06`, "Grocer", 20000, { categoryId: "g", categoryName: "Groceries" }),
    ]);
    const share = run(txs).find((i) => i.key === "saving:dining-share");
    expect(share?.title).toBe("60% of food spending is eating out");
    const balanced = txs.map((t) => (t.categoryName === "Groceries" ? { ...t, amountCents: 60000 } : t));
    expect(run(balanced).some((i) => i.key === "saving:dining-share")).toBe(false);
  });

  it("recognises bank fees", () => {
    expect(isBankFee({ title: "NSF FEE", merchantName: null, pfcPrimary: null })).toBe(true);
    expect(isBankFee({ title: "Monthly account fee", merchantName: null, pfcPrimary: null })).toBe(true);
    expect(isBankFee({ title: "Anything", merchantName: null, pfcPrimary: "BANK_FEES" })).toBe(true);
    expect(isBankFee({ title: "Coffee", merchantName: null, pfcPrimary: null })).toBe(false);
    const fees = run([tx("2026-09-01", "Overdraft interest charge", 500)]).find((i) => i.key === "saving:bank-fees");
    expect(fees?.annualCents).toBe(500);
  });

  describe("with a short history", () => {
    const order = (d: string) => tx(d, "UBER EATS", 4000, { categoryName: "Restaurants" });

    it("works out delivery spend over the days logged, not a full 90", () => {
      // Logging began 45 days before NOW; 6 orders of $40 is $240 in 45 days.
      const txs = ["2026-08-11", "2026-08-20", "2026-08-28", "2026-09-05", "2026-09-12", "2026-09-20"].map(order);
      const delivery = run(txs).find((i) => i.key === "saving:delivery-apps");
      expect(delivery?.monthlyCents).toBe(Math.round(24000 / (45 / (365.25 / 12))));
      expect(delivery?.body).toContain("in the last 45 days");
    });

    it("stays quiet with under a month of history", () => {
      const txs = ["2026-09-05", "2026-09-07", "2026-09-09", "2026-09-11", "2026-09-13", "2026-09-15", "2026-09-17", "2026-09-20"].map(order);
      expect(run(txs).some((i) => i.key === "saving:delivery-apps")).toBe(false);
    });
  });
});

