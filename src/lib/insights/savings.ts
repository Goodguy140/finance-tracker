import type { RecurringCadence } from "@prisma/client";
import { matchHabitKind } from "./habit-patterns";
import { MONTHLY_FACTOR, type RecurringCandidate } from "./recurring-detection";
import type { Insight, InsightRecurringRule, InsightTx } from "./types";
import {
  DAYS_PER_MONTH,
  daysAgo,
  daysBetween,
  evidenceIds,
  median,
  merchantKeyFor,
  merchantLabelFor,
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
  return [
    ...priceIncreases(input),
    ...stackedStreaming(input),
    ...possibleDuplicates(input),
    ...frequentSmallPurchases(input),
    ...deliveryApps(input),
    ...diningShare(input),
    ...bankFees(input),
  ];
}

// --- Price increases -------------------------------------------------------------------------

const PRICE_INCREASE_MIN_PCT = 0.05;
const PRICE_INCREASE_MIN_CENTS = 50;
const PRICE_INCREASE_RECENT_DAYS = 60;

type Series = { id: string; label: string; cadence: RecurringCadence; txs: InsightTx[] };

function priceIncreases({ txs, rules, candidates, now, fmt }: SavingsInput): Insight[] {
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
    if (daysBetween(last.date, now) > PRICE_INCREASE_RECENT_DAYS) continue;
    const before = median(sorted.slice(0, -1).map((tx) => tx.amountCents));
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
      evidenceTxIds: evidenceIds(sorted, 6),
    });
  }
  return out;
}

// --- Streaming and media services ------------------------------------------------------------

export const STREAMING_SERVICES: Array<{ name: string; re: RegExp }> = [
  { name: "Netflix", re: /\bnetflix\b/ },
  { name: "Disney+", re: /\bdisney\s*(?:\+|plus)\b|\bdisneyplus\b/ },
  { name: "Crave", re: /\bcrave\b/ },
  { name: "Prime Video", re: /\bprime video\b|\bamazon prime\b/ },
  { name: "Apple TV+", re: /\bapple tv\b/ },
  { name: "Spotify", re: /\bspotify\b/ },
  { name: "Apple Music", re: /\bapple music\b/ },
  { name: "YouTube Premium", re: /\byoutube (?:premium|music)\b/ },
  { name: "Paramount+", re: /\bparamount\b/ },
  { name: "Max", re: /\bhbo\b|\bmax\.com\b/ },
  { name: "Hulu", re: /\bhulu\b/ },
  { name: "Peacock", re: /\bpeacock\b/ },
  { name: "DAZN", re: /\bdazn\b/ },
  { name: "Audible", re: /\baudible\b/ },
  { name: "SiriusXM", re: /\bsirius\s*xm\b/ },
  { name: "Tidal", re: /\btidal\b/ },
  { name: "Deezer", re: /\bdeezer\b/ },
  { name: "BritBox", re: /\bbritbox\b/ },
];
const STREAMING_MIN_SERVICES = 3;

export function streamingServiceFor(text: string | null | undefined): string | null {
  const lower = (text ?? "").toLowerCase();
  if (!lower) return null;
  return STREAMING_SERVICES.find((s) => s.re.test(lower))?.name ?? null;
}

function stackedStreaming({ txs, rules, candidates, now, fmt }: SavingsInput): Insight[] {
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
  // Anything charged in the last ~6 weeks that neither a rule nor a detection covered.
  const since = daysAgo(now, 45);
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || tx.date < since || tx.amountCents <= 0) continue;
    const name = streamingServiceFor(tx.merchantName) ?? streamingServiceFor(tx.title);
    if (!name) continue;
    evidence.push(tx);
    if (!monthlyByService.has(name)) monthlyByService.set(name, tx.amountCents);
  }
  if (monthlyByService.size < STREAMING_MIN_SERVICES) return [];

  const names = [...monthlyByService.keys()].sort();
  const monthlyCents = [...monthlyByService.values()].reduce((a, b) => a + b, 0);
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
      evidenceTxIds: evidenceIds(evidence, 8),
    },
  ];
}

// --- Possible duplicate charges --------------------------------------------------------------

const DUPLICATE_MIN_CENTS = 2_000;
/** Same or next day: a card authorisation and its re-post. Further apart is usually two trips. */
const DUPLICATE_MAX_GAP_DAYS = 1;
const DUPLICATE_LOOKBACK_DAYS = 60;

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
        !matchHabitKind({ texts: [tx.title, tx.merchantName, tx.note], pfcDetailed: tx.pfcDetailed }),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const out: Insight[] = [];
  const used = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a.id)) continue;
    const key = merchantKeyFor(a);
    if (!key) continue;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (daysBetween(a.date, b.date) > DUPLICATE_MAX_GAP_DAYS) break;
      if (used.has(b.id) || b.amountCents !== a.amountCents || merchantKeyFor(b) !== key) continue;
      used.add(a.id);
      used.add(b.id);
      out.push({
        key: `saving:duplicate:${a.id}:${b.id}`,
        section: "saving",
        severity: "high",
        title: `Possible double charge at ${merchantLabelFor(a)}`,
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
const GROCERY_CATEGORY = /grocer|supermarket|食費/i;

function frequentSmallPurchases({ txs, now, fmt }: SavingsInput): Insight[] {
  const since = daysAgo(now, WINDOW_DAYS);
  const months = WINDOW_DAYS / DAYS_PER_MONTH;
  const groups = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || tx.date < since || tx.recurringTransactionId) continue;
    if (tx.amountCents <= 0 || tx.amountCents > SMALL_PURCHASE_MAX_CENTS) continue;
    // Groceries are necessary; delivery apps and habit purchases have insights of their own.
    if (GROCERY_CATEGORY.test(tx.categoryName) || isDeliveryApp(tx)) continue;
    if (matchHabitKind({ texts: [tx.title, tx.merchantName, tx.note], pfcDetailed: tx.pfcDetailed, categoryName: tx.categoryName })) continue;
    const key = merchantKeyFor(tx);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const out: Insight[] = [];
  for (const [key, list] of groups) {
    const perMonth = list.length / months;
    const monthlyCents = Math.round(list.reduce((s, tx) => s + tx.amountCents, 0) / months);
    if (perMonth < SMALL_PURCHASE_MIN_PER_MONTH || monthlyCents < SMALL_PURCHASE_MIN_MONTHLY_CENTS) continue;
    const annualCents = monthlyCents * 12;
    const label = merchantLabelFor(list[0]);
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
      evidenceTxIds: evidenceIds(list),
    });
  }
  return out.sort((a, b) => (b.annualCents ?? 0) - (a.annualCents ?? 0)).slice(0, 3);
}

// --- Delivery apps ---------------------------------------------------------------------------

const DELIVERY_APP = /\buber\s*eats\b|\bubereats\b|\bdoordash\b|\bskip ?the ?dishes\b|\bgrubhub\b|\binstacart\b|\bfantuan\b/;
const DELIVERY_MIN_MONTHLY_CENTS = 10_000;

function isDeliveryApp(tx: InsightTx): boolean {
  return [tx.title, tx.merchantName].some((t) => !!t && DELIVERY_APP.test(t.toLowerCase()));
}

function deliveryApps({ txs, now, fmt }: SavingsInput): Insight[] {
  const since = daysAgo(now, WINDOW_DAYS);
  const hits = txs.filter((tx) => tx.type === "EXPENSE" && tx.date >= since && isDeliveryApp(tx));
  const monthlyCents = Math.round(hits.reduce((s, tx) => s + tx.amountCents, 0) / (WINDOW_DAYS / DAYS_PER_MONTH));
  if (monthlyCents < DELIVERY_MIN_MONTHLY_CENTS) return [];
  const annualCents = monthlyCents * 12;
  return [
    {
      key: "saving:delivery-apps",
      section: "saving",
      severity: monthlyCents >= 30_000 ? "medium" : "low",
      title: `Delivery apps: about ${fmt(monthlyCents)} a month`,
      body:
        `${hits.length} orders in the last ${WINDOW_DAYS} days. Service fees, delivery fees and menu mark-ups ` +
        `often add 20–30%; picking up the same order yourself would save roughly ${fmt(Math.round(annualCents * 0.2))} a year.`,
      monthlyCents,
      annualCents,
      evidenceTxIds: evidenceIds(hits),
    },
  ];
}

// --- Eating out vs groceries -----------------------------------------------------------------

const DINING_CATEGORY = /dining|eating out|restaurant|take ?out|delivery|fast food|外食/i;
const DINING_SHARE_THRESHOLD = 0.4;
const DINING_MIN_MONTHLY_CENTS = 15_000;

/** Spend per category for one transaction, honouring split parts. */
export function categoryAmounts(tx: InsightTx): Array<{ categoryId: string; categoryName: string; amountCents: number }> {
  if (tx.splits.length) return tx.splits;
  return [{ categoryId: tx.categoryId, categoryName: tx.categoryName, amountCents: tx.amountCents }];
}

function diningShare({ txs, now, fmt }: SavingsInput): Insight[] {
  const months = new Set(previousFullMonths(now, 3));
  let dining = 0;
  let grocery = 0;
  const evidence: InsightTx[] = [];
  for (const tx of txs) {
    if (tx.type !== "EXPENSE" || !months.has(ymOf(tx.date))) continue;
    for (const part of categoryAmounts(tx)) {
      if (DINING_CATEGORY.test(part.categoryName)) {
        dining += part.amountCents;
        if (evidence[evidence.length - 1] !== tx) evidence.push(tx);
      } else if (GROCERY_CATEGORY.test(part.categoryName)) grocery += part.amountCents;
    }
  }
  const monthlyDining = Math.round(dining / 3);
  if (dining <= 0 || monthlyDining < DINING_MIN_MONTHLY_CENTS) return [];
  const share = dining / (dining + Math.max(grocery, 0));
  if (share < DINING_SHARE_THRESHOLD) return [];
  const annualCents = monthlyDining * 12;
  return [
    {
      key: "saving:dining-share",
      section: "saving",
      severity: share >= 0.6 ? "medium" : "low",
      title: `${Math.round(share * 100)}% of food spending is eating out`,
      body:
        `Over the last three months you spent about ${fmt(monthlyDining)} a month eating out or ordering in, ` +
        `against ${fmt(Math.round(Math.max(grocery, 0) / 3))} on groceries. Swapping a quarter of those meals ` +
        `for cooking would save roughly ${fmt(Math.round((annualCents / 4) * 0.6))} a year after the extra groceries.`,
      monthlyCents: monthlyDining,
      annualCents,
      evidenceTxIds: evidenceIds(evidence, 8),
    },
  ];
}

// --- Bank fees and interest ------------------------------------------------------------------

const FEE_TEXT =
  /\bnsf\b|non-?sufficient|overdraft|\bmonthly (?:account |plan )?fee\b|service charge|\binterest charge|purchase interest|cash advance (?:fee|interest)|foreign (?:transaction|exchange|currency) fee|\bfx fee\b|\bannual fee\b|\blate (?:payment )?fee\b|\batm fee\b|\bnetwork fee\b/;

export function isBankFee(tx: Pick<InsightTx, "title" | "merchantName" | "pfcPrimary">): boolean {
  if (tx.pfcPrimary === "BANK_FEES") return true;
  return [tx.title, tx.merchantName].some((t) => !!t && FEE_TEXT.test(t.toLowerCase()));
}

function bankFees({ txs, now, fmt }: SavingsInput): Insight[] {
  const since = daysAgo(now, 365);
  const fees = txs.filter((tx) => tx.type === "EXPENSE" && tx.amountCents > 0 && tx.date >= since && isBankFee(tx));
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
      evidenceTxIds: evidenceIds(fees),
    },
  ];
}
