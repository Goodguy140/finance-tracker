import { CategoryKind } from "@prisma/client";
import { z } from "zod";
import type { InsightItemView } from "@/components/insights/insight-item";
import { scoreBand, type FinancialScore } from "@/lib/financial-score";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { INSIGHT_SNOOZE_DAYS } from "@/lib/insights/dismiss";
import { loadInsights } from "@/lib/insights/load";
import { insightViews } from "@/lib/insights/view";
import { HABIT_CATEGORY_NAMES } from "@/lib/insights/habit-patterns";
import { prisma } from "@/lib/prisma";
import { insightKeySchema, trackHabitSchema } from "@/lib/validation";

/**
 * Insights and the financial score as `/api/v1/insights` and `/api/v1/score` give them to the
 * phone app. Both come from the loaders behind the website's Insights page, so the two show the
 * same insights and the same score. An insight whose button leads somewhere says which page of
 * the website it opens (`website`, for apps from before `track`); one the phone can act on itself
 * also says how (`track`): a recurring charge with the website's "Track it" form filled in, or a
 * habit to file under a category of its own (`POST /api/v1/insights/track-habit`).
 */

type User = { id: string; countryCode: string; timezone: string | null };

/** The page of the website an insight's button leads to, and what the button says. */
function websiteAction(action: InsightItemView["action"]): { path: string; label: string } | null {
  if (!action) return null;
  if (action.kind === "link") return { path: action.href, label: action.label };
  if (action.kind === "track-recurring") return { path: "/insights#insights-recurring", label: "Track it" };
  return { path: "/insights#insights-habit", label: "Track separately" };
}

/** What the phone needs to do an insight's "Track it" or "Track separately" itself. */
function appTrack(action: InsightItemView["action"], expenseCategories: ReadonlyMap<string, string>) {
  if (action?.kind === "track-recurring") {
    const p = action.prefill;
    return {
      kind: "recurring" as const,
      /** The website's "Track it" form as it opens. */
      prefill: {
        name: p.name,
        type: p.type === "INCOME" ? ("income" as const) : ("expense" as const),
        amountCents: p.amountCents,
        cadence: p.cadence.toLowerCase() as Lowercase<typeof p.cadence>,
        accountId: p.accountId,
        categoryId: p.categoryId,
        nextExpectedDate: p.nextExpectedDate,
        semiMonthly: p.semiMonthly
          ? { firstDay: p.semiMonthly.day, secondDay: p.semiMonthly.secondDay, beforeWeekend: p.semiMonthly.beforeWeekend }
          : null,
      },
    };
  }
  if (action?.kind === "track-habit") {
    const categoryName = HABIT_CATEGORY_NAMES[action.habit];
    return {
      kind: "habit" as const,
      habit: action.habit,
      categoryName,
      /** The category it is already filed under, once tracked; null until then. */
      trackedCategoryId: expenseCategories.get(categoryName.toLowerCase()) ?? null,
    };
  }
  return null;
}

export function serializeAppInsight(view: InsightItemView, expenseCategories: ReadonlyMap<string, string> = new Map()) {
  return {
    /** Stable across loads: what dismissing and restoring name. */
    key: view.key,
    section: view.section,
    severity: view.severity,
    title: view.title,
    body: view.body,
    monthlyCents: view.monthlyCents ?? null,
    annualCents: view.annualCents ?? null,
    /** What following it would save in a year, with nothing counted twice across insights. */
    savingCents: view.savingCents ?? null,
    /** The transactions it is about, newest first. */
    evidence: view.evidence.map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title || null,
      amountCents: row.amountCents,
      type: row.type.toLowerCase() as Lowercase<typeof row.type>,
    })),
    website: websiteAction(view.action),
    track: appTrack(view.action, expenseCategories),
    /** Only on a hidden one: snoozed until this `YYYY-MM-DD`, or null when dismissed for good. */
    ...(view.dismissedUntil !== undefined ? { hiddenUntil: view.dismissedUntil } : {}),
  };
}

export type AppInsight = ReturnType<typeof serializeAppInsight>;

export async function loadAppInsights(user: User) {
  const [loaded, categories] = await Promise.all([
    loadInsights(user.id, user.countryCode, user.timezone),
    prisma.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, select: { id: true, name: true } }),
  ]);
  const { visible, dismissed } = insightViews(loaded);
  // Matched ignoring case, as the website tells a tracked habit from an untracked one.
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  return {
    currency: loaded.currency,
    snoozeDays: INSIGHT_SNOOZE_DAYS,
    insights: visible.map((view) => serializeAppInsight(view, byName)),
    /** Dismissed or snoozed, for putting back. */
    hidden: dismissed.map((view) => serializeAppInsight(view, byName)),
  };
}

export function serializeAppScore(score: FinancialScore, currency: string) {
  if (score.status === "insufficient") return { status: "insufficient" as const, currency, reason: score.reason };
  return {
    status: "scored" as const,
    currency,
    score: score.score,
    band: score.band,
    /** Full months it is worked out from, oldest first, `YYYY-MM`. */
    months: score.months,
    change: score.change,
    pillars: score.pillars.map((pillar) => ({
      id: pillar.id,
      label: pillar.label,
      score: pillar.score,
      band: pillar.score === null ? null : scoreBand(pillar.score),
      weight: pillar.weight,
      note: pillar.note,
    })),
    factors: score.factors.map((factor) => ({
      id: factor.id,
      pillar: factor.pillar,
      label: factor.label,
      score: factor.score,
      band: scoreBand(factor.score),
      weight: factor.weight,
      detail: factor.detail,
      suggestion: factor.suggestion,
    })),
    /** From the weakest factors, weakest first; empty when nothing stands out. */
    suggestions: score.suggestions,
    /** Factors left out for lack of data, and why. */
    omitted: score.omitted,
    otherCurrencyAccounts: score.otherCurrencyAccounts,
    emergencyTargetMonths: score.emergencyTargetMonths,
  };
}

export type AppScore = ReturnType<typeof serializeAppScore>;

export async function loadAppScore(user: User): Promise<AppScore> {
  const { score, currency } = await loadFinancialScore(user);
  return serializeAppScore(score, currency);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const dismissBody = z.object({
  key: insightKeySchema.shape.insightKey,
  mode: z.enum(["snooze", "forever"]).default("forever"),
});
const restoreBody = z.object({ key: insightKeySchema.shape.insightKey });

function parse<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid body." };
}

/** `{ "key", "mode" }`: `snooze` hides it for `INSIGHT_SNOOZE_DAYS`, `forever` (the default) for good. */
export function parseDismissBody(body: unknown): Parsed<{ key: string; mode: "snooze" | "forever" }> {
  return parse(dismissBody, body);
}

/** `{ "habit" }`: the habit insight's `track.habit`. */
export function parseTrackHabitBody(body: unknown): Parsed<{ habit: z.infer<typeof trackHabitSchema>["habit"] }> {
  return parse(trackHabitSchema.strict(), body);
}

/** `{ "key" }`: the dismissed or snoozed insight to list again. */
export function parseRestoreBody(body: unknown): Parsed<{ key: string }> {
  return parse(restoreBody, body);
}
