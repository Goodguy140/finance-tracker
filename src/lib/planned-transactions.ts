import { RecurringCadence } from "@prisma/client";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

/**
 * Planned one-off expenses and income: a car repair in March, a tax refund in April.
 *
 * The forecasts (Upcoming bills, Calendar, projected balances, Safe to spend) take a plan as a
 * recurring rule with a single occurrence: a monthly rule that starts and ends on the plan's
 * date. `forecastRecurringOccurrences` then lists it once, as overdue while its date has passed
 * this month, and not at all once its month is over — the same treatment as a missed bill, so
 * neither is counted twice. An open plan from an earlier month surfaces as "Did this happen?".
 */

export type PlanForForecast = {
  id: string;
  type: "EXPENSE" | "INCOME";
  amountCents: number;
  date: Date;
};

export function plannedAsForecastRules<P extends PlanForForecast>(plans: readonly P[]) {
  return plans.map((plan) => ({
    ...plan,
    cadence: RecurringCadence.MONTHLY,
    nextExpectedDate: plan.date,
    anchorDay: null,
    endDate: plan.date,
    enabled: true,
    transferAccountId: null,
    planned: true as const,
  }));
}

/**
 * Matching a plan to the entry that turned out to be it, typed, imported or from the bank.
 *
 * A candidate was recorded after the plan was saved (an entry already in the log is not what
 * the user is planning for), has the plan's type and account, and is dated from a week before
 * the plan to two weeks after it (a bill paid early, a refund that came late). Then either the amount is the
 * same, or the category is and the amount is within 10% (the repair cost a little less than
 * quoted). Requiring the category for an approximate amount keeps a $95 grocery run from
 * settling a planned $100 dinner on the same card.
 *
 * Each entry settles at most one plan. The best pairs go first: an exact amount, then the same
 * category, then the nearest date, then the nearest amount.
 */
export const PLAN_MATCH_DAYS_BEFORE = 7;
export const PLAN_MATCH_DAYS_AFTER = 14;

export type PlanToMatch = {
  id: string;
  type: "EXPENSE" | "INCOME";
  accountId: string;
  categoryId: string;
  amountCents: number;
  dateYmd: string;
  createdAt: Date;
};

export type EntryToMatch = {
  id: string;
  type: string;
  accountId: string | null;
  categoryId: string;
  amountCents: number;
  dateYmd: string;
  createdAt: Date;
};

function dayNumber(ymd: string): number {
  return Math.round(dateFromYmd(ymd).getTime() / 86_400_000);
}

export function planMatchScore(plan: PlanToMatch, entry: EntryToMatch): number[] | null {
  if (entry.type !== plan.type || entry.accountId !== plan.accountId) return null;
  if (entry.createdAt.getTime() < plan.createdAt.getTime()) return null;
  const offset = dayNumber(entry.dateYmd) - dayNumber(plan.dateYmd);
  if (offset < -PLAN_MATCH_DAYS_BEFORE || offset > PLAN_MATCH_DAYS_AFTER) return null;
  const amountGap = Math.abs(entry.amountCents - plan.amountCents);
  const exact = amountGap === 0;
  const sameCategory = entry.categoryId === plan.categoryId;
  if (!exact && !(sameCategory && amountGap * 10 <= Math.abs(plan.amountCents))) return null;
  // Lower is better, compared in order.
  return [exact ? 0 : 1, sameCategory ? 0 : 1, Math.abs(offset), amountGap];
}

function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Plan id → entry id for every plan an entry settles. */
export function matchPlannedTransactions(
  plans: readonly PlanToMatch[],
  entries: readonly EntryToMatch[],
): Map<string, string> {
  const pairs: Array<{ planId: string; entryId: string; score: number[] }> = [];
  for (const plan of plans) {
    for (const entry of entries) {
      const score = planMatchScore(plan, entry);
      if (score) pairs.push({ planId: plan.id, entryId: entry.id, score });
    }
  }
  pairs.sort((a, b) => compareScores(a.score, b.score));
  const matched = new Map<string, string>();
  const usedEntries = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.planId) || usedEntries.has(pair.entryId)) continue;
    matched.set(pair.planId, pair.entryId);
    usedEntries.add(pair.entryId);
  }
  return matched;
}

/** The date range entries are searched over to settle `plans`, or null when there are none. */
export function planMatchWindow(plans: readonly { dateYmd: string }[]): { gte: Date; lt: Date } | null {
  if (plans.length === 0) return null;
  const ymds = plans.map((p) => p.dateYmd).sort();
  const gte = dateFromYmd(ymds[0]);
  gte.setUTCDate(gte.getUTCDate() - PLAN_MATCH_DAYS_BEFORE);
  const lt = dateFromYmd(ymds[ymds.length - 1]);
  lt.setUTCDate(lt.getUTCDate() + PLAN_MATCH_DAYS_AFTER + 1);
  return { gte, lt };
}

/** Open plans whose date has passed: the ones to ask "Did this happen?" about. */
export function isPlanPastDue(plan: { date: Date }, todayYmd: string): boolean {
  return ymdFromDateUtc(plan.date) < todayYmd;
}
