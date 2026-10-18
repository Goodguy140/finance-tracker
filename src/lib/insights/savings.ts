import type { RecurringCadence } from "@prisma/client";
import { categoryAmounts, categoryRole, factsOf, hasHabitSpend, streamingServiceFor } from "./facts";
import { MONTHLY_FACTOR, type RecurringCandidate } from "./recurring-detection";
import type { Insight, InsightRecurringRule, InsightTx } from "./types";
import {
  DAYS_PER_MONTH,
  daysAgo,
  daysBetween,
  evidenceIds,
  historyStartOf,
  median,
  MIN_OBSERVED_DAYS,
  observedDays,
  observedMonths,
  previousFullMonths,
  ymOf,
  type MoneyFormatter,
} from "./util";

/**
 * Places the data says money is leaking: a subscription that got dearer, a stack of streaming
 * services, a charge that landed twice, a small purchase repeated until it is a big one, and
 * fees that were avoidable. Every figure is computed from the user's own history; the
 * suggested saving is always a modest fraction, never "stop entirely".
 */

export type SavingsInput = {
  txs: InsightTx[];
  rules: InsightRecurringRule[];
  candidates: RecurringCandidate[];
  now: Date;
  fmt: MoneyFormatter;
};

export function detectSavingsOpportunities(input: SavingsInput): Insight[] {
  // Several ideas can reach the same money: an Uber Eats order filed under Dining is both a
  // delivery order and a meal out. Each records what it already counts toward its saving, so
  // the next leaves that out and the page's total adds every dollar once.
  const counted = new Set<string>();
  const rotatedServices = new Set<string>();
  const streaming = stackedStreaming(input, rotatedServices);
  const frequent = frequentSmallPurchases(input, counted);
  const delivery = deliveryApps(input, counted);
  return [
    ...priceIncreases(input, rotatedServices),
    ...streaming,
    ...possibleDuplicates(input),
    ...frequent,
    ...delivery,
    ...diningShare(input, counted),
    ...bankFees(input),
  ];
}

// --- Price increases -------------------------------------------------------------------------

const PRICE_INCREASE_MIN_PCT = 0.05;
const PRICE_INCREASE_MIN_CENTS = 50;
const PRICE_INCREASE_RECENT_DAYS = 60;

type Series = { id: string; label: string; cadence: RecurringCadence; txs: InsightTx[] };

/** Charges this close to the latest are the same price: tax rounding, a cent of exchange. */
const SAME_PRICE_PCT = 0.02;
/** The old price is the median of this many charges before the step, so one odd bill can't set it. */
const PRICE_BEFORE_CHARGES = 3;

/** Index of the first charge in the run at the latest price, oldest first; 0 when it never changed. */
export function currentPriceStart(sorted: readonly InsightTx[]): number {
  const latest = sorted[sorted.length - 1].amountCents;
  let i = sorted.length - 1;
  while (i > 0 && Math.abs(sorted[i - 1].amountCents - latest) <= latest * SAME_PRICE_PCT) i--;
  return i;
}

function priceIncreases({ txs, rules, candidates, now, fmt }: SavingsInput, rotatedServices: ReadonlySet<string>): Insight[] {
  const series: Series[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "EXPENSE") continue;
    const linked = txs.filter((tx) => tx.recurringTransactionId === rule.id);
    series.push({ id: rule.id, label: rule.name, cadence: rule.cadence, txs: linked });
  }
  for (const c of candidates) {
    if (c.type !== "EXPENSE") continue;
    series.push({ id: c.merchantKey, label: c.label, cadence: c.cadence, txs: c.txs });
  }

  const out: Insight[] = [];
  for (const s of series) {
    const sorted = [...s.txs].filter((tx) => tx.amountCents > 0).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (sorted.length < 3) continue;
    const last = sorted[sorted.length - 1];
    // The charges at today's price, and the step up to it: a rise is news while the step is
    // recent, not for as long as the old price still outnumbers the new one in the history.
    const step = currentPriceStart(sorted);
    if (step === 0 || daysBetween(sorted[step].date, now) > PRICE_INCREASE_RECENT_DAYS) continue;
    const before = median(sorted.slice(Math.max(0, step - PRICE_BEFORE_CHARGES), step).map((tx) => tx.amountCents));
    const diff = last.amountCents - before;
    if (diff < PRICE_INCREASE_MIN_CENTS || diff < before * PRICE_INCREASE_MIN_PCT) continue;
    const annualCents = Math.round(diff * MONTHLY_FACTOR[s.cadence] * 12);
    out.push({
      // The new price is part of the key, so dismissing this rise does not hide the next one.
      key: `saving:price-increase:${s.id}:${last.amountCents}`,
      section: "saving",
      severity: annualCents >= 5_000 ? "medium" : "low",
      title: `${s.label} went up`,
      body:
        `The latest charge was ${fmt(last.amountCents)}, up from ${fmt(before)} — ${fmt(annualCents)} more a year. ` +
        `Worth checking for a cheaper plan, an annual option, or whether you still use it.`,
      annualCents,
      // A service the streaming idea already suggests dropping saves its whole price there.
      savingCents: rotatedServices.has(streamingServiceFor(s.label) ?? "") ? 0 : annualCents,
      evidenceTxIds: evidenceIds(sorted, 6),
    });
  }
  return out;
}

// --- Streaming and media services ------------------------------------------------------------

const STREAMING_MIN_SERVICES = 3;
/** Two monthly bills and some slack. */
const STREAMING_RECENT_DAYS = 75;

/** Rotating means keeping this many at a time; the saving is what the rest cost. */
const STREAMING_KEEP = 2;

function stackedStreaming({ txs, rules, candidates, now, fmt }: SavingsInput, rotatedServices: Set<string>): Insight[] {
  const monthlyByService = new Map<string, number>();
  const evidence: InsightTx[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "EXPENSE") continue;
    const name = streamingServiceFor(rule.name);
    if (name) monthlyByService.set(name, Math.round(rule.amountCents * MONTHLY_FACTOR[rule.cadence]));
  }
  for (const c of candidates) {
    const name = streamingServiceFor(c.label);
    if (name && !monthlyByService.has(name)) {
      monthlyByService.set(name, Math.round(c.medianAmountCents * MONTHLY_FACTOR[c.cadence]));
    }
  }
  // A service neither a rule nor a detection covered counts once it has billed twice lately:
  // one charge is as likely a meal at Crave Burger as a Crave subscription.
  const since = daysAgo(now, STREAMING_RECENT_DAYS);
  const recentByService = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || tx.date < since || tx.amountCents <= 0) continue;
    const name = factsOf(tx).streamingService;
    if (!name) continue;
    recentByService.set(name, [...(recentByService.get(name) ?? []), tx]);
  }
  for (const [name, charges] of recentByService) {
    if (!monthlyByService.has(name)) {
      if (charges.length < 2) continue;
      monthlyByService.set(name, median(charges.map((tx) => tx.amountCents)));
    }
    evidence.push(...charges);
  }
  if (monthlyByService.size < STREAMING_MIN_SERVICES) return [];

  const names = [...monthlyByService.keys()].sort();
  const monthlyCents = [...monthlyByService.values()].reduce((a, b) => a + b, 0);
  const rotated = [...monthlyByService.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(STREAMING_KEEP);
  for (const [name] of rotated) rotatedServices.add(name);
  return [
    {
      key: `saving:streaming:${names.join(",")}`,
      section: "saving",
      severity: monthlyCents >= 6_000 ? "medium" : "low",
      title: `${names.length} streaming and media services`,
      body:
        `${names.join(", ")} come to about ${fmt(monthlyCents)} a month (${fmt(monthlyCents * 12)} a year). ` +
        `Rotating them — subscribing to one or two at a time and switching when you run out of things to watch — ` +
        `is an easy way to trim this.`,
      monthlyCents,
      annualCents: monthlyCents * 12,
      savingCents: rotated.reduce((sum, [, cents]) => sum + cents, 0) * 12,
      evidenceTxIds: evidenceIds(evidence, 8),
    },
  ];
}

// --- Possible duplicate charges --------------------------------------------------------------

const DUPLICATE_MIN_CENTS = 2_000;
/** Same or next day: a card authorisation and its re-post. Further apart is usually two trips. */
const DUPLICATE_MAX_GAP_DAYS = 1;
const DUPLICATE_LOOKBACK_DAYS = 60;
/** A refund this soon after the pair means the merchant already put it right. */
const DUPLICATE_REFUND_DAYS = 30;

function possibleDuplicates({ txs, now, fmt }: SavingsInput): Insight[] {
  const since = daysAgo(now, DUPLICATE_LOOKBACK_DAYS);
  const pool = txs
    .filter(
      (tx) =>
        tx.type === "EXPENSE" &&
        tx.amountCents >= DUPLICATE_MIN_CENTS &&
        tx.date >= since &&
        !tx.recurringTransactionId &&
        // Repeat habit purchases have their own insight; two in a day is not a billing error.
        !hasHabitSpend(tx),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const refunds = txs.filter((tx) => tx.type === "EXPENSE" && tx.amountCents < 0 && tx.date >= since);
  const usedRefunds = new Set<string>();

  const out: Insight[] = [];
  const used = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a.id)) continue;
    const key = factsOf(a).merchantKey;
    if (!key) continue;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (daysBetween(a.date, b.date) > DUPLICATE_MAX_GAP_DAYS) break;
      if (used.has(b.id) || b.amountCents !== a.amountCents || factsOf(b).merchantKey !== key) continue;
      used.add(a.id);
      used.add(b.id);
      const refund = refunds.find(
        (r) =>
          !usedRefunds.has(r.id) &&
          r.amountCents === -a.amountCents &&
          r.date >= a.date &&
          daysBetween(b.date, r.date) <= DUPLICATE_REFUND_DAYS &&
          factsOf(r).merchantKey === key,
      );
      if (refund) {
        usedRefunds.add(refund.id);
        break;
      }
      out.push({
        key: `saving:duplicate:${a.id}:${b.id}`,
        section: "saving",
        // Two genuine purchases of the same thing (two transit passes) look exactly like this,
        // so it is worth a look rather than the most pressing thing on the page.
        severity: "medium",
        title: `Possible double charge at ${factsOf(a).merchantLabel}`,
        body:
          `Two charges of ${fmt(a.amountCents)} ${a.date.getTime() === b.date.getTime() ? "on the same day" : "a day apart"}. ` +
          `If you only bought once, ask the merchant or your bank to reverse one.`,
        evidenceTxIds: [b.id, a.id],
      });
      break;
    }
  }
  return out;
}

// --- Small purchases that add up -------------------------------------------------------------

const SMALL_PURCHASE_MAX_CENTS = 2_500;
const SMALL_PURCHASE_MIN_PER_MONTH = 4;
const SMALL_PURCHASE_MIN_MONTHLY_CENTS = 4_000;
const WINDOW_DAYS = 90;

/**
 * Days of the trailing window the history covers, or null when that is too little to turn
 * into a monthly rate: two coffees in someone's first week are not "eight a month".
 */
function rateWindowDays(txs: InsightTx[], now: Date): number | null {
  const days = observedDays(now, historyStartOf(txs), WINDOW_DAYS);
  return days >= MIN_OBSERVED_DAYS ? days : null;
}

function frequentSmallPurchases({ txs, now, fmt }: SavingsInput, counted: Set<string>): Insight[] {
  const windowDays = rateWindowDays(txs, now);
  if (windowDays === null) return [];
  const since = daysAgo(now, WINDOW_DAYS);
  const months = windowDays / DAYS_PER_MONTH;
  const groups = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || tx.date < since || tx.recurringTransactionId) continue;
    if (tx.amountCents <= 0 || tx.amountCents > SMALL_PURCHASE_MAX_CENTS) continue;
    // Groceries are necessary; delivery apps and habit purchases have insights of their own.
    if (categoryRole(tx.categoryName) === "grocery" || factsOf(tx).deliveryApp || hasHabitSpend(tx)) continue;
    const key = factsOf(tx).merchantKey;
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const out: Array<Insight & { txs: InsightTx[] }> = [];
  for (const [key, list] of groups) {
    const perMonth = list.length / months;
    const monthlyCents = Math.round(list.reduce((s, tx) => s + tx.amountCents, 0) / months);
    if (perMonth < SMALL_PURCHASE_MIN_PER_MONTH || monthlyCents < SMALL_PURCHASE_MIN_MONTHLY_CENTS) continue;
    const annualCents = monthlyCents * 12;
    const label = factsOf(list[0]).merchantLabel;
    out.push({
      key: `saving:frequent:${key}`,
      section: "saving",
      severity: annualCents >= 100_000 ? "medium" : "low",
      title: `${label} adds up`,
      body:
        `About ${Math.round(perMonth)} visits a month averaging ${fmt(Math.round(monthlyCents / perMonth))} — ` +
        `${fmt(annualCents)} a year. Cutting back by a quarter would save about ${fmt(Math.round(annualCents / 4))} a year.`,
      monthlyCents,
      annualCents,
      savingCents: Math.round(annualCents / 4),
      evidenceTxIds: evidenceIds(list),
      txs: list,
    });
  }
  const top = out.sort((a, b) => (b.annualCents ?? 0) - (a.annualCents ?? 0)).slice(0, 3);
  for (const { txs: list } of top) for (const tx of list) counted.add(tx.id);
  return top.map(({ txs: _txs, ...insight }) => insight);
}

// --- Delivery apps ---------------------------------------------------------------------------

const DELIVERY_MIN_MONTHLY_CENTS = 10_000;

function deliveryApps({ txs, now, fmt }: SavingsInput, counted: Set<string>): Insight[] {
  const windowDays = rateWindowDays(txs, now);
  if (windowDays === null) return [];
  const since = daysAgo(now, WINDOW_DAYS);
  const hits = txs.filter((tx) => tx.type === "EXPENSE" && tx.date >= since && factsOf(tx).deliveryApp);
  const monthlyCents = Math.round(hits.reduce((s, tx) => s + tx.amountCents, 0) / (windowDays / DAYS_PER_MONTH));
  if (monthlyCents < DELIVERY_MIN_MONTHLY_CENTS) return [];
  const annualCents = monthlyCents * 12;
  const savingCents = Math.round(annualCents * 0.2);
  for (const tx of hits) counted.add(tx.id);
  return [
    {
      key: "saving:delivery-apps",
      section: "saving",
      severity: monthlyCents >= 30_000 ? "medium" : "low",
      title: `Delivery apps: about ${fmt(monthlyCents)} a month`,
      body:
        `${hits.length} orders in the last ${windowDays} days. Service fees, delivery fees and menu mark-ups ` +
        `often add 20–30%; picking up the same order yourself would save roughly ${fmt(savingCents)} a year.`,
      monthlyCents,
      annualCents,
      savingCents,
      evidenceTxIds: evidenceIds(hits),
    },
  ];
}

// --- Eating out vs groceries -----------------------------------------------------------------

const DINING_SHARE_THRESHOLD = 0.4;
const DINING_MIN_MONTHLY_CENTS = 15_000;

function diningShare({ txs, now, fmt }: SavingsInput, counted: ReadonlySet<string>): Insight[] {
  const monthList = observedMonths(previousFullMonths(now, 3), historyStartOf(txs));
  if (monthList.length < 2) return [];
  const months = new Set(monthList);
  const monthCount = monthList.length;
  let dining = 0;
  /** Dining no other idea has already counted: what cooking more would save on. */
  let diningUncounted = 0;
  let grocery = 0;
  const evidence: InsightTx[] = [];
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || !months.has(ymOf(tx.date))) continue;
    for (const part of categoryAmounts(tx)) {
      const role = categoryRole(part.categoryName);
      if (role === "dining") {
        dining += part.amountCents;
        if (!counted.has(tx.id)) diningUncounted += part.amountCents;
        if (evidence[evidence.length - 1] !== tx) evidence.push(tx);
      } else if (role === "grocery") grocery += part.amountCents;
    }
  }
  const monthlyDining = Math.round(dining / monthCount);
  if (dining <= 0 || monthlyDining < DINING_MIN_MONTHLY_CENTS) return [];
  const share = dining / (dining + Math.max(grocery, 0));
  if (share < DINING_SHARE_THRESHOLD) return [];
  const annualCents = monthlyDining * 12;
  // Swap a quarter of the meals; the extra groceries eat about 40% of what that saves.
  const savingCents = Math.round((Math.round(diningUncounted / monthCount) * 12) / 4 * 0.6);
  const alsoCounted = diningUncounted < dining ? " on top of the ideas above" : "";
  return [
    {
      key: "saving:dining-share",
      section: "saving",
      severity: share >= 0.6 ? "medium" : "low",
      title: `${Math.round(share * 100)}% of food spending is eating out`,
      body:
        `Over the last ${monthCount === 3 ? "three" : "two"} months you spent about ${fmt(monthlyDining)} a month eating out or ordering in, ` +
        `against ${fmt(Math.round(Math.max(grocery, 0) / monthCount))} on groceries. Swapping a quarter of those meals ` +
        `for cooking would save roughly ${fmt(savingCents)} a year${alsoCounted}, after the extra groceries.`,
      monthlyCents: monthlyDining,
      annualCents,
      savingCents,
      evidenceTxIds: evidenceIds(evidence, 8),
    },
  ];
}

// --- Bank fees and interest ------------------------------------------------------------------

function bankFees({ txs, now, fmt }: SavingsInput): Insight[] {
  const since = daysAgo(now, 365);
  const fees = txs.filter((tx) => tx.type === "EXPENSE" && tx.amountCents > 0 && tx.date >= since && factsOf(tx).bankFee);
  if (fees.length === 0) return [];
  const totalCents = fees.reduce((s, tx) => s + tx.amountCents, 0);
  return [
    {
      key: "saving:bank-fees",
      section: "saving",
      severity: totalCents >= 10_000 ? "medium" : "low",
      title: `${fmt(totalCents)} in bank fees and interest`,
      body:
        `${fees.length} fee or interest charge${fees.length === 1 ? "" : "s"} in the last 12 months. ` +
        `Many banks waive monthly fees above a minimum balance or on a no-fee plan, and paying a card's ` +
        `statement balance in full each month avoids interest altogether.`,
      annualCents: totalCents,
      savingCents: totalCents,
      evidenceTxIds: evidenceIds(fees),
    },
  ];
}
