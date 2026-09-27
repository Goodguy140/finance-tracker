import { HABIT_PATTERNS, matchHabit, matchHabitKind } from "./habit-patterns";
import type { HabitKind, Insight, InsightTx } from "./types";
import { DAYS_PER_MONTH, daysAgo, evidenceIds, merchantLabelFor, type MoneyFormatter } from "./util";

/**
 * Spending on things people commonly find hard to cut back on — tobacco and vaping, cannabis,
 * alcohol, gambling, in-game purchases.
 *
 * Reports facts (how often, how much, which way it is heading) and never a verdict: the app
 * cannot know whether a purchase was for the user, a gift, or a party. The wording is left
 * neutral for the same reason.
 */

export const HABIT_WINDOW_DAYS = 90;
const RECENT_DAYS = 30;

export type HabitSummary = {
  kind: HabitKind;
  label: string;
  count: number;
  totalCents: number;
  monthlyCents: number;
  trend: "rising" | "steady" | "falling";
  /** Distinct display names, most frequent first. */
  merchants: string[];
  /** What "track separately" rules match on: one per merchant, most frequent first. */
  rulePatterns: string[];
  txs: InsightTx[];
};

type HabitHit = { tx: InsightTx; amountCents: number };

/** The part of a transaction that is habit spending, if any. */
function habitHitsFor(tx: InsightTx): Array<{ kind: HabitKind; hit: HabitHit }> {
  if (tx.type !== "EXPENSE") return [];
  const texts = [tx.title, tx.merchantName, tx.note];
  const whole = matchHabitKind({ texts, pfcDetailed: tx.pfcDetailed, categoryName: tx.splits.length ? null : tx.categoryName });
  if (whole) return [{ kind: whole, hit: { tx, amountCents: tx.amountCents } }];
  // A split receipt counts only the parts the user filed under a habit category.
  return tx.splits.flatMap((part) => {
    const kind = matchHabitKind({ texts: [], categoryName: part.categoryName });
    return kind ? [{ kind, hit: { tx, amountCents: part.amountCents } }] : [];
  });
}

/**
 * The text a rule should look for to catch this merchant again: the habit words that matched
 * ("lcbo", "tokyo smoke", "fire & flower"), which catch every branch without naming one.
 * When only Plaid's category or the user's own category said so, the title is all there is.
 */
export function rulePatternFor(tx: InsightTx): string {
  const match = matchHabit({ texts: [tx.title, tx.merchantName, tx.note] });
  return match?.matchedText ?? (tx.title ?? "").trim();
}

function rankedDistinct(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

export function summarizeHabitSpending(txs: InsightTx[], now: Date): HabitSummary[] {
  const windowStart = daysAgo(now, HABIT_WINDOW_DAYS);
  const recentStart = daysAgo(now, RECENT_DAYS);
  const byKind = new Map<HabitKind, HabitHit[]>();
  for (const tx of txs) {
    if (tx.date < windowStart || tx.date > now) continue;
    for (const { kind, hit } of habitHitsFor(tx)) {
      const list = byKind.get(kind);
      if (list) list.push(hit);
      else byKind.set(kind, [hit]);
    }
  }

  const out: HabitSummary[] = [];
  for (const pattern of HABIT_PATTERNS) {
    const hits = byKind.get(pattern.kind);
    if (!hits) continue;
    const purchases = hits.filter((h) => h.amountCents > 0);
    const totalCents = hits.reduce((sum, h) => sum + h.amountCents, 0);
    if (purchases.length < pattern.minCount && totalCents < pattern.minCents) continue;
    if (totalCents <= 0) continue;

    const recentCents = hits.filter((h) => h.tx.date >= recentStart).reduce((s, h) => s + h.amountCents, 0);
    const earlierMonthlyCents = (totalCents - recentCents) / ((HABIT_WINDOW_DAYS - RECENT_DAYS) / RECENT_DAYS);
    let trend: HabitSummary["trend"] = "steady";
    if (recentCents > earlierMonthlyCents * 1.25 && recentCents - earlierMonthlyCents >= 1_000) trend = "rising";
    else if (recentCents < earlierMonthlyCents * 0.75 && earlierMonthlyCents - recentCents >= 1_000) trend = "falling";

    const txList = hits.map((h) => h.tx);
    out.push({
      kind: pattern.kind,
      label: pattern.label,
      count: purchases.length,
      totalCents,
      monthlyCents: Math.round(totalCents / (HABIT_WINDOW_DAYS / DAYS_PER_MONTH)),
      trend,
      merchants: rankedDistinct(txList.map((tx) => merchantLabelFor(tx))),
      rulePatterns: rankedDistinct(txList.map(rulePatternFor)),
      txs: txList,
    });
  }
  return out;
}

const TREND_SENTENCE: Record<HabitSummary["trend"], string> = {
  rising: " It has gone up over the last 30 days.",
  steady: "",
  falling: " It has come down over the last 30 days.",
};

export function habitInsights(summaries: HabitSummary[], fmt: MoneyFormatter): Insight[] {
  return summaries.map((s) => {
    const annualCents = s.monthlyCents * 12;
    const where = s.merchants.length ? `, mostly at ${s.merchants.slice(0, 3).join(", ")}` : "";
    return {
      key: `habit:${s.kind}`,
      section: "habit",
      severity: s.trend === "rising" || s.monthlyCents >= 15_000 ? "high" : "medium",
      title: `${s.label}: about ${fmt(s.monthlyCents)} a month`,
      body:
        `${s.count} purchase${s.count === 1 ? "" : "s"} in the last ${HABIT_WINDOW_DAYS} days${where} — ` +
        `about ${fmt(annualCents)} a year at this pace.${TREND_SENTENCE[s.trend]} ` +
        `If you want to cut back, giving it its own category and budget makes the trend easy to watch.`,
      monthlyCents: s.monthlyCents,
      annualCents,
      evidenceTxIds: evidenceIds(s.txs),
      action: { kind: "track-habit", habit: s.kind, merchants: s.rulePatterns.slice(0, 8) },
    };
  });
}
