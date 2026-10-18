import { describe, expect, it } from "vitest";
import type { FinancialScore, FinancialScoreFactor } from "@/lib/financial-score";
import { scoreInsights } from "./score";

const factor = (id: FinancialScoreFactor["id"], score: number, suggestion: string | null): FinancialScoreFactor => ({
  id,
  label: { savings: "Savings rate", emergency: "Emergency fund", bills: "Fixed bills", budgets: "Budgets kept", trend: "Spending trend", consistency: "Months in the black" }[id],
  score,
  weight: 1 / 6,
  detail: `Detail for ${id}`,
  suggestion,
});

const scored = (factors: FinancialScoreFactor[]): FinancialScore => ({
  status: "scored",
  score: 50,
  band: "Fair",
  months: ["2026-07", "2026-08", "2026-09"],
  factors,
  suggestions: [],
  omitted: [],
});

describe("scoreInsights", () => {
  it("lists the weakest factors with a suggestion as improvement insights, keyed by the last month scored", () => {
    const insights = scoreInsights(
      scored([
        factor("savings", 20, "Save more."),
        factor("emergency", 50, "Build a cushion."),
        factor("bills", 90, "Strong already."),
        factor("budgets", 70, "Keep a budget."),
        factor("trend", 10, null),
        factor("consistency", 60, "Stay in the black."),
      ]),
    );
    expect(insights.map((i) => [i.key, i.severity, i.body])).toEqual([
      ["score:savings:2026-09", "high", "Save more."],
      ["score:emergency:2026-09", "medium", "Build a cushion."],
      ["score:consistency:2026-09", "medium", "Stay in the black."],
    ]);
    expect(insights[0]).toMatchObject({ section: "improvement", title: "Savings rate: detail for savings", evidenceTxIds: [] });
  });

  it("says nothing until there is a score", () => {
    expect(scoreInsights({ status: "insufficient", reason: "needs a month" })).toEqual([]);
  });
});
