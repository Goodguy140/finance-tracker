import { weakestFactors, type FinancialScore } from "@/lib/financial-score";
import type { Insight } from "./types";

/**
 * The financial score's "where to improve" as ordinary insights, so they sit in one list with
 * the rest on the Insights page: dismissable and snoozable like any other, and never saying
 * the same thing twice in two places on the page. The score card there shows the number and
 * its factors; Reports still lists the suggestions on the card.
 *
 * Keyed by factor and the last month scored, so dismissing one hides it until the next month's
 * figures are in.
 */
export function scoreInsights(score: FinancialScore): Insight[] {
  if (score.status !== "scored") return [];
  const lastMonth = score.months[score.months.length - 1];
  return weakestFactors(score.factors).map((factor) => ({
    key: `score:${factor.id}:${lastMonth}`,
    section: "improvement",
    severity: factor.score < 35 ? "high" : factor.score < 65 ? "medium" : "low",
    title: `${factor.label}: ${factor.detail.charAt(0).toLowerCase()}${factor.detail.slice(1)}`,
    body: factor.suggestion as string,
    evidenceTxIds: [],
  }));
}
