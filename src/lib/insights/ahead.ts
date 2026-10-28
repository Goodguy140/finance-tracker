import {
  computeBudgetWarnings,
  computeOverBudgetTrends,
  daysLeftInMonthYm,
  type BudgetProgressInput,
} from "@/lib/budget-alerts";
import { cardsDueWithin, type CardTerms } from "@/lib/credit-cards";
import type { ProjectedBalances } from "@/lib/projected-balances";
import type { Insight, InsightRecurringRule } from "./types";
import { DAY_MS, type MoneyFormatter } from "./util";

/**
 * "Coming up": what is about to happen if nothing changes, worked out from the user's
 * balances, budgets and recurring entries rather than read off past spending.
 *
 * Each key carries the date or month it is about, so dismissing one hides that occurrence and
 * not the next.
 */
export type AheadInput = {
  /** `projectBalances` for the user's accounts; null under a tag filter. */
  projection: ProjectedBalances | null;
  /** This month's budget progress; null under a tag filter. */
  budgets: BudgetProgressInput[] | null;
  rules: InsightRecurringRule[];
  /** Credit cards with a due day; null or left out says nothing about card payments. */
  cards?: CardTerms[] | null;
  now: Date;
  fmt: MoneyFormatter;
};

export function detectAhead(input: AheadInput): Insight[] {
  return [...lowBalances(input), ...cardPayments(input), ...budgetPace(input), ...renewals(input)];
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" });

function daysUntil(now: Date, date: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((date.getTime() - today) / DAY_MS);
}

// --- Low balance ahead -----------------------------------------------------------------------

/**
 * An older reading says little about where the account stands now: whatever posted since is in
 * neither it nor the forecast, which applies only scheduled entries.
 */
export const LOW_BALANCE_MAX_READING_AGE_DAYS = 31;
/** Within this many days is pressing; further out there is time to move money. */
const LOW_BALANCE_SOON_DAYS = 14;

function lowBalances({ projection, now, fmt }: AheadInput): Insight[] {
  if (!projection) return [];
  return projection.accounts.flatMap((account): Insight[] => {
    const dip = account.belowZero;
    if (!dip || account.liability) return [];
    if (daysUntil(now, account.asOf) < -LOW_BALANCE_MAX_READING_AGE_DAYS) return [];
    const days = daysUntil(now, dip.date);
    const when = shortDate.format(dip.date);
    return [
      {
        key: `ahead:low-balance:${account.accountId}:${dip.date.toISOString().slice(0, 10)}`,
        section: "ahead",
        severity: days <= LOW_BALANCE_SOON_DAYS ? "high" : "medium",
        title: `${account.name} could drop below ${fmt(0)} on ${when}`,
        body:
          `From ${fmt(account.currentCents)} on ${shortDate.format(account.asOf)}, the recurring bills and income ` +
          `you have set up take it below zero on ${when}${dip.cause ? `, when ${dip.cause} is due` : ""}, ` +
          `and as low as ${fmt(dip.lowestCents)}. Moving money in or shifting a bill before then would cover it.`,
        evidenceTxIds: [],
        action: { kind: "link", href: "/reports", label: "See projected balances" },
      },
    ];
  });
}

// --- Card payments due ----------------------------------------------------------------------

/** A week is time to move money for it without it being news a month early. */
export const CARD_DUE_NOTICE_DAYS = 7;
const CARD_DUE_SOON_DAYS = 3;

function cardPayments({ cards, now, fmt }: AheadInput): Insight[] {
  if (!cards?.length) return [];
  return cardsDueWithin(cards, now.toISOString().slice(0, 10), CARD_DUE_NOTICE_DAYS).map((due): Insight => {
    const when = due.daysAway === 0 ? "today" : due.daysAway === 1 ? "tomorrow" : `in ${due.daysAway} days`;
    return {
      key: `ahead:card-due:${due.accountId}:${due.date.toISOString().slice(0, 10)}`,
      section: "ahead",
      severity: due.daysAway <= CARD_DUE_SOON_DAYS ? "medium" : "low",
      title: `${due.name} payment due ${when}${due.owedCents === null ? "" : `, balance ${fmt(due.owedCents)}`}`,
      body:
        `Due ${shortDate.format(due.date)}.${due.minimumCents ? ` The minimum is ${fmt(due.minimumCents)}.` : ""} ` +
        "Paying the full statement balance by then avoids interest.",
      evidenceTxIds: [],
    };
  });
}

// --- Budget pace -----------------------------------------------------------------------------

/**
 * This month's budgets, as the dashboard's budget alerts see them: one insight per category,
 * the most serious of over budget, on pace to go over, or nearly used.
 */
function budgetPace({ budgets, now, fmt }: AheadInput): Insight[] {
  if (!budgets?.length) return [];
  const ym = now.toISOString().slice(0, 7);
  const daysLeft = daysLeftInMonthYm(now, ym);
  const month = longMonth.format(now);
  const left = `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in ${month}`;
  const warnings = new Map(computeBudgetWarnings(budgets, { ym, reference: now }).map((w) => [w.categoryId, w]));
  const trends = new Map(computeOverBudgetTrends(budgets, { ym, reference: now }).map((t) => [t.categoryId, t]));
  return budgets.flatMap((row): Insight[] => {
    const base = { section: "ahead" as const, evidenceTxIds: [], action: BUDGET_LINK };
    const spent = `${fmt(row.spentCents)} of ${fmt(row.limitCents)} spent`;
    const warning = warnings.get(row.categoryId);
    if (warning?.severity === "critical") {
      return [
        {
          ...base,
          key: `ahead:budget:${row.categoryId}:${ym}:over`,
          severity: "high",
          title: `${row.categoryName} is ${fmt(row.spentCents - row.limitCents)} over budget`,
          body: `${spent}, with ${left}.`,
        },
      ];
    }
    const trend = trends.get(row.categoryId);
    if (trend && trend.projectedOverCents > 0) {
      return [
        {
          ...base,
          key: `ahead:budget:${row.categoryId}:${ym}:pace`,
          severity: "medium",
          title: `${row.categoryName} is on pace to go ${fmt(trend.projectedOverCents)} over budget`,
          body: `${spent} so far, with ${left}. At this rate the month ends near ${fmt(row.limitCents + trend.projectedOverCents)}.`,
        },
      ];
    }
    if (warning) {
      return [
        {
          ...base,
          key: `ahead:budget:${row.categoryId}:${ym}:nearly`,
          severity: "low",
          title: `${row.categoryName} is ${warning.percentUsed}% used`,
          body: `${spent}, ${fmt(warning.remainingCents)} to go, with ${left}.`,
        },
      ];
    }
    return [];
  });
}

const BUDGET_LINK: Insight["action"] = { kind: "link", href: "/settings/categories", label: "Adjust budget" };

// --- Yearly renewals -------------------------------------------------------------------------

/** How far ahead a yearly charge is worth a mention: time to cancel before it renews. */
export const RENEWAL_NOTICE_DAYS = 30;
const RENEWAL_SOON_DAYS = 14;

function renewals({ rules, now, fmt }: AheadInput): Insight[] {
  return rules.flatMap((rule): Insight[] => {
    if (!rule.enabled || rule.type !== "EXPENSE" || !rule.nextExpectedDate) return [];
    if (rule.cadence !== "YEARLY" && rule.cadence !== "BIENNIAL") return [];
    const days = daysUntil(now, rule.nextExpectedDate);
    if (days < 0 || days > RENEWAL_NOTICE_DAYS) return [];
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const every = rule.cadence === "YEARLY" ? "once a year" : "every two years";
    return [
      {
        key: `ahead:renewal:${rule.id}:${rule.nextExpectedDate.toISOString().slice(0, 10)}`,
        section: "ahead",
        severity: days <= RENEWAL_SOON_DAYS ? "medium" : "low",
        title: `${rule.name} is due ${when}`,
        body:
          `${fmt(rule.amountCents)} on ${shortDate.format(rule.nextExpectedDate)}, ${every}. ` +
          `If it is a membership or subscription you no longer use, now is the time to cancel.`,
        annualCents: rule.cadence === "YEARLY" ? rule.amountCents : Math.round(rule.amountCents / 2),
        evidenceTxIds: [],
      },
    ];
  });
}
