import type { RecurringCadence, TransactionType } from "@prisma/client";
import { ymdFromDateUtc } from "@/lib/date-only";
import { advanceRecurringDate, advanceRecurringDateOnOrAfter } from "@/lib/recurring-transactions";
import type { Insight, InsightRecurringRule, InsightTx, RecurringPrefill } from "./types";
import {
  daysBetween,
  evidenceIds,
  median,
  merchantKeyFor,
  merchantLabelFor,
  mostCommon,
  type MoneyFormatter,
} from "./util";

/**
 * Spotting charges that repeat on a schedule but have no recurring rule yet.
 *
 * Deliberately conservative: a false "this is a subscription" prompt is more annoying than a
 * missed one, since the user can always add a rule by hand. A group has to repeat on one
 * cadence, at a steady amount, and still be happening.
 */

type CadenceBand = { cadence: RecurringCadence; minDays: number; maxDays: number; typicalDays: number; minCount: number };

/** Ordered shortest first; bands do not overlap. BIENNIAL is out of reach of a year of history. */
export const CADENCE_BANDS: CadenceBand[] = [
  { cadence: "WEEKLY", minDays: 6, maxDays: 8, typicalDays: 7, minCount: 4 },
  { cadence: "BIWEEKLY", minDays: 13, maxDays: 16, typicalDays: 14, minCount: 3 },
  { cadence: "MONTHLY", minDays: 27, maxDays: 33, typicalDays: 30.4, minCount: 3 },
  { cadence: "QUARTERLY", minDays: 85, maxDays: 97, typicalDays: 91, minCount: 2 },
  { cadence: "YEARLY", minDays: 355, maxDays: 375, typicalDays: 365, minCount: 2 },
];

/** Share of gaps that must fall in the band, and of amounts that must sit near the median. */
const MIN_REGULAR_SHARE = 0.75;
const AMOUNT_TOLERANCE_PCT = 0.15;
const AMOUNT_TOLERANCE_MIN_CENTS = 200;
/** A series is over once it has missed half a cycle beyond its next due date. */
const ACTIVE_GRACE_FACTOR = 1.5;

export const MONTHLY_FACTOR: Record<RecurringCadence, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  YEARLY: 1 / 12,
  BIENNIAL: 1 / 24,
};

export type RecurringCandidate = {
  key: string;
  merchantKey: string;
  label: string;
  type: TransactionType;
  cadence: RecurringCadence;
  medianAmountCents: number;
  /** Oldest first. */
  txs: InsightTx[];
  confidence: number;
  prefill: RecurringPrefill;
};

export function isWithinAmountTolerance(amountCents: number, medianCents: number): boolean {
  const tolerance = Math.max(Math.abs(medianCents) * AMOUNT_TOLERANCE_PCT, AMOUNT_TOLERANCE_MIN_CENTS);
  return Math.abs(amountCents - medianCents) <= tolerance;
}

/** Confidence for a series that is steady only on each side of one price change. */
const PRICE_CHANGE_CONFIDENCE = 0.9;

/**
 * The latest price when `amounts` (oldest first) hold steady at one level, then at another
 * from some charge on, with at least two charges before the change; null otherwise.
 */
export function steadyAcrossOneChange(amounts: readonly number[]): number | null {
  const steady = (part: readonly number[]) => {
    const mid = median([...part]);
    return part.every((a) => isWithinAmountTolerance(a, mid));
  };
  for (let k = amounts.length - 1; k >= 2; k--) {
    const before = amounts.slice(0, k);
    const after = amounts.slice(k);
    if (steady(before) && steady(after)) return median(after);
  }
  return null;
}

export function classifyCadence(gapsDays: number[]): { band: CadenceBand; regularShare: number } | null {
  if (gapsDays.length === 0) return null;
  const mid = median(gapsDays);
  const band = CADENCE_BANDS.find((b) => mid >= b.minDays && mid <= b.maxDays);
  if (!band) return null;
  const fits = (gap: number, cycles: number) => gap >= band.minDays * cycles && gap <= band.maxDays * cycles;
  let regular = 0;
  for (let i = 0; i < gapsDays.length; i++) {
    if (fits(gapsDays[i], 1)) regular++;
    else if (i + 1 < gapsDays.length && fits(gapsDays[i] + gapsDays[i + 1], 2)) {
      // One charge that landed late (or early) skews the gap on both sides of it; together
      // they still span exactly two cycles, so the schedule held.
      regular += 2;
      i++;
    }
  }
  return { band, regularShare: regular / gapsDays.length };
}

function groupKey(type: TransactionType, merchantKey: string) {
  return `${type}|${merchantKey}`;
}

/** Transactions already tied to a rule, or named like one, mean the user has this covered. */
function coveredGroupKeys(txs: InsightTx[], rules: InsightRecurringRule[]): Set<string> {
  const covered = new Set<string>();
  for (const tx of txs) {
    if (tx.recurringTransactionId) covered.add(groupKey(tx.type, merchantKeyFor(tx)));
  }
  for (const rule of rules) {
    if (!rule.enabled) continue;
    covered.add(groupKey(rule.type, merchantKeyFor({ title: rule.name, merchantName: null })));
  }
  return covered;
}

export function detectRecurringCandidates(
  txs: InsightTx[],
  rules: InsightRecurringRule[],
  now: Date,
): RecurringCandidate[] {
  const covered = coveredGroupKeys(txs, rules);
  const groups = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    if (tx.recurringTransactionId || tx.splits.length > 0 || tx.amountCents <= 0) continue;
    const merchantKey = merchantKeyFor(tx);
    if (!merchantKey) continue;
    const key = groupKey(tx.type, merchantKey);
    if (covered.has(key)) continue;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const list of groups.values()) {
    const candidate = evaluateGroup(list, now);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

function evaluateGroup(unsorted: InsightTx[], now: Date): RecurringCandidate | null {
  if (unsorted.length < 2) return null;
  const txs = [...unsorted].sort((a, b) => a.date.getTime() - b.date.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < txs.length; i++) gaps.push(daysBetween(txs[i - 1].date, txs[i].date));

  const cadence = classifyCadence(gaps);
  if (!cadence || cadence.regularShare < MIN_REGULAR_SHARE) return null;
  const { band } = cadence;
  if (txs.length < band.minCount) return null;

  const amounts = txs.map((tx) => tx.amountCents);
  let medianAmountCents = median(amounts);
  let stableShare = amounts.filter((a) => isWithinAmountTolerance(a, medianAmountCents)).length / amounts.length;
  if (stableShare < MIN_REGULAR_SHARE) {
    // A subscription whose price went up once is still a subscription — and exactly the one a
    // "went up" insight needs to see. Steady before, steady after, and the current price counts.
    const changed = steadyAcrossOneChange(amounts);
    if (changed === null) return null;
    medianAmountCents = changed;
    stableShare = PRICE_CHANGE_CONFIDENCE;
  }

  const last = txs[txs.length - 1];
  if (daysBetween(last.date, now) > band.typicalDays * ACTIVE_GRACE_FACTOR) return null;

  const merchantKey = merchantKeyFor(last);
  const categoryId = mostCommon(txs.map((tx) => tx.categoryId)) ?? last.categoryId;
  const accountId = mostCommon(txs.map((tx) => tx.accountId).filter((id): id is string => id != null)) ?? null;
  // Strictly after the last charge — one that landed today is not also the next one.
  const nextExpected = advanceRecurringDateOnOrAfter(advanceRecurringDate(last.date, band.cadence), band.cadence, now);

  return {
    key: `recurring:${last.type}:${merchantKey}`,
    merchantKey,
    label: merchantLabelFor(last),
    type: last.type,
    cadence: band.cadence,
    medianAmountCents,
    txs,
    confidence: Math.round(cadence.regularShare * stableShare * 100) / 100,
    prefill: {
      name: merchantLabelFor(last).slice(0, 80),
      type: last.type,
      // The latest charge, not the median: after a price change the next bill is the new price.
      amountCents: last.amountCents,
      cadence: band.cadence,
      accountId,
      categoryId,
      nextExpectedDate: ymdFromDateUtc(nextExpected),
    },
  };
}

const CADENCE_WORDS: Record<RecurringCadence, string> = {
  WEEKLY: "every week",
  BIWEEKLY: "every two weeks",
  MONTHLY: "every month",
  QUARTERLY: "every three months",
  YEARLY: "every year",
  BIENNIAL: "every two years",
};

export function recurringCandidateInsights(candidates: RecurringCandidate[], fmt: MoneyFormatter): Insight[] {
  return candidates.map((c) => {
    const monthlyCents = Math.round(c.medianAmountCents * MONTHLY_FACTOR[c.cadence]);
    const verb = c.type === "INCOME" ? "arrives" : "is charged";
    return {
      key: c.key,
      section: "recurring",
      severity: c.type === "EXPENSE" && monthlyCents >= 5_000 ? "medium" : "low",
      title: `${c.label} looks recurring`,
      body:
        `About ${fmt(c.medianAmountCents)} ${verb} ${CADENCE_WORDS[c.cadence]} — ${c.txs.length} times so far, ` +
        `with no recurring entry for it. Track it to see it coming and have it post for review.`,
      monthlyCents,
      annualCents: monthlyCents * 12,
      evidenceTxIds: evidenceIds(c.txs),
      action: { kind: "track-recurring", prefill: c.prefill },
    };
  });
}
