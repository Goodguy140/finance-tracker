import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { matchHabitKind } = await import("./habit-patterns");
const { habitInsights, rulePatternFor, summarizeHabitSpending } = await import("./habits");
const { moneyFormatter } = await import("./util");

describe("matchHabitKind", () => {
  const kindOf = (text: string) => matchHabitKind({ texts: [text] });

  it("recognises common retailers and words", () => {
    expect(kindOf("SQDC MONTREAL QC")).toBe("CANNABIS");
    expect(kindOf("Tokyo Smoke Queen St")).toBe("CANNABIS");
    expect(kindOf("LCBO #217")).toBe("ALCOHOL");
    expect(kindOf("Vape Shop Plus")).toBe("TOBACCO_VAPE");
    expect(kindOf("BET99 DEPOSIT")).toBe("GAMBLING");
    expect(kindOf("OLG Lotto Max")).toBe("GAMBLING");
    expect(kindOf("Roblox Corporation")).toBe("GAMING_PURCHASES");
  });

  it("does not fire on look-alikes", () => {
    expect(kindOf("Weed Man Lawn Care")).toBeNull();
    expect(kindOf("Tweed Heads Cafe")).toBeNull();
    expect(kindOf("Circle K")).toBeNull();
    expect(kindOf("Saquaro Grill")).toBeNull();
    expect(kindOf("Olga's Bakery")).toBeNull();
  });

  it("uses Plaid's detailed category and the user's own category name", () => {
    expect(matchHabitKind({ texts: ["Corner Store"], pfcDetailed: "GENERAL_MERCHANDISE_TOBACCO_AND_VAPE" })).toBe(
      "TOBACCO_VAPE",
    );
    expect(matchHabitKind({ texts: ["Corner Store"], categoryName: "Smokes" })).toBe("TOBACCO_VAPE");
  });
});

describe("summarizeHabitSpending", () => {
  it("flags repeat purchases in the window with a monthly figure", () => {
    const txs = [
      tx("2026-07-10", "SQDC", 4000),
      tx("2026-08-10", "SQDC", 4000),
      tx("2026-09-01", "SQDC", 4000),
      tx("2026-09-20", "Tokyo Smoke", 4000),
      tx("2026-01-01", "SQDC", 99999), // outside the window
    ];
    const [summary] = summarizeHabitSpending(txs, NOW);
    expect(summary.kind).toBe("CANNABIS");
    expect(summary.count).toBe(4);
    expect(summary.totalCents).toBe(16000);
    expect(summary.monthlyCents).toBe(Math.round(16000 / (90 / (365.25 / 12))));
    expect(summary.trend).toBe("rising");
    expect(summary.rulePatterns).toEqual(["sqdc", "tokyo smoke"]);
  });

  it("builds rule patterns from the words that matched, else the title", () => {
    expect(rulePatternFor(tx("2026-09-01", "Fire & Flower Yonge", 1000))).toBe("fire & flower");
    expect(rulePatternFor(tx("2026-09-01", "Corner Store", 1000, { categoryName: "Smokes" }))).toBe("Corner Store");
    expect(rulePatternFor(tx("2026-09-01", "LCBO #217 TORONTO ON", 1000))).toBe("lcbo");
    expect(rulePatternFor(tx("2026-09-01", "Tokyo Smoke Queen St", 1000))).toBe("tokyo smoke");
  });

  it("stays quiet on a one-off", () => {
    expect(summarizeHabitSpending([tx("2026-09-01", "LCBO", 2500)], NOW)).toEqual([]);
  });

  it("counts only the habit part of a split receipt", () => {
    const receipt = tx("2026-09-10", "Costco", 20000, {
      splits: [
        { categoryId: "g", categoryName: "Groceries", amountCents: 14000 },
        { categoryId: "a", categoryName: "Alcohol", amountCents: 6000 },
      ],
    });
    const [summary] = summarizeHabitSpending([receipt], NOW);
    expect(summary.kind).toBe("ALCOHOL");
    expect(summary.totalCents).toBe(6000);
  });

  it("produces a neutral insight with a track-separately action", () => {
    const txs = ["2026-07-01", "2026-08-01", "2026-09-01"].map((d) => tx(d, "LCBO #217", 3000));
    const [insight] = habitInsights(summarizeHabitSpending(txs, NOW), moneyFormatter());
    expect(insight.key).toBe("habit:ALCOHOL");
    expect(insight.section).toBe("habit");
    expect(insight.action).toEqual({ kind: "track-habit", habit: "ALCOHOL", merchants: ["lcbo"] });
  });
});
