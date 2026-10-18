import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { categoryRole, factsOf } = await import("./facts");
const { detectSavingsOpportunities } = await import("./savings");
const { detectRecurringCandidates } = await import("./recurring-detection");
const { moneyFormatter } = await import("./util");
import type { InsightTx } from "./types";

function savings(txs: InsightTx[]) {
  return detectSavingsOpportunities({ txs, rules: [], candidates: detectRecurringCandidates(txs, [], NOW), now: NOW, fmt: moneyFormatter() });
}

describe("factsOf", () => {
  it("works a row out once", () => {
    const row = tx("2026-09-10", "SQ *BLUE BOTTLE #412", 650);
    expect(factsOf(row)).toBe(factsOf(row));
    expect(factsOf(row).merchantKey).toBe(factsOf(tx("2026-09-11", "Blue Bottle", 700)).merchantKey);
  });

  it("gives every detector the same answer about habit spending", () => {
    // Filed under Alcohol with a neutral title: the habit insight counts it, so the
    // double-charge check must not flag two of them in a day as a billing error.
    const txs = [
      tx("2026-09-10", "Corner Store", 3000, { categoryName: "Alcohol" }),
      tx("2026-09-10", "Corner Store", 3000, { categoryName: "Alcohol" }),
    ];
    expect(factsOf(txs[0]).habitParts).toEqual([{ kind: "ALCOHOL", amountCents: 3000 }]);
    expect(savings(txs).some((i) => i.key.startsWith("saving:duplicate"))).toBe(false);
  });

  it("does not count Instacart as restaurant delivery", () => {
    expect(factsOf(tx("2026-09-10", "INSTACART", 9000)).deliveryApp).toBe(false);
    expect(factsOf(tx("2026-09-10", "UBER EATS", 3000)).deliveryApp).toBe(true);
  });
});

describe("categoryRole", () => {
  it("reads English, French and Japanese category names", () => {
    expect(categoryRole("Dining")).toBe("dining");
    expect(categoryRole("Restos")).toBe("dining");
    expect(categoryRole("外食")).toBe("dining");
    expect(categoryRole("Groceries")).toBe("grocery");
    expect(categoryRole("Épicerie")).toBe("grocery");
    expect(categoryRole("食費")).toBe("grocery");
    expect(categoryRole("CELI")).toBe("savings");
    expect(categoryRole("Épargne")).toBe("savings");
    expect(categoryRole("Rent")).toBeNull();
  });
});
