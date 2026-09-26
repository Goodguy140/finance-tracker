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
});
