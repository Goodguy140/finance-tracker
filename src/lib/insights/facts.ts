import { matchHabitKind } from "./habit-patterns";
import type { HabitKind, InsightTx } from "./types";
import { merchantKeyFor, merchantLabelFor } from "./util";

/**
 * What the detectors need to know about a transaction, worked out once per row.
 *
 * Every detector used to ask these questions itself, with slightly different inputs: one
 * counted a purchase as a habit by its category name and another did not, so the same LCBO
 * receipt could be habit spending in one insight and an ordinary purchase in the next. Asking
 * here, once, gives every detector the same answer, and saves re-running the merchant
 * cleanup's regexes for the same row in each of them (and in the duplicate check's inner loop).
 *
 * Memoised per row object, so it costs nothing to call from anywhere.
 */
export type TxFacts = {
  /** What rows from the same merchant share (`merchantKeyFor`). */
  merchantKey: string;
  /** A name to show for the merchant (`merchantLabelFor`). */
  merchantLabel: string;
  /**
   * The habit spending in the row, by kind: the whole amount when the row itself matches, else
   * only the split parts filed under a habit category. Empty for anything that is not an expense.
   */
  habitParts: Array<{ kind: HabitKind; amountCents: number }>;
  /** Food ordered through a delivery app. */
  deliveryApp: boolean;
  /** A bank fee or interest charge. */
  bankFee: boolean;
  /** The streaming or media service it is a charge from, if any. */
  streamingService: string | null;
};

const factsCache = new WeakMap<InsightTx, TxFacts>();

export function factsOf(tx: InsightTx): TxFacts {
  let facts = factsCache.get(tx);
  if (!facts) {
    facts = {
      merchantKey: merchantKeyFor(tx),
      merchantLabel: merchantLabelFor(tx),
      habitParts: habitPartsOf(tx),
      deliveryApp: textMatches(tx, DELIVERY_APP),
      bankFee: tx.pfcPrimary === "BANK_FEES" || textMatches(tx, FEE_TEXT),
      streamingService: streamingServiceFor(tx.merchantName) ?? streamingServiceFor(tx.title),
    };
    factsCache.set(tx, facts);
  }
  return facts;
}

/** Whether any of the row is habit spending; such rows are left to the habit insight. */
export function hasHabitSpend(tx: InsightTx): boolean {
  return factsOf(tx).habitParts.length > 0;
}

function habitPartsOf(tx: InsightTx): TxFacts["habitParts"] {
  if (tx.type !== "EXPENSE") return [];
  const texts = [tx.title, tx.merchantName, tx.note];
  const whole = matchHabitKind({ texts, pfcDetailed: tx.pfcDetailed, categoryName: tx.splits.length ? null : tx.categoryName });
  if (whole) return [{ kind: whole, amountCents: tx.amountCents }];
  // A split receipt counts only the parts the user filed under a habit category.
  return tx.splits.flatMap((part) => {
    const kind = matchHabitKind({ texts: [], categoryName: part.categoryName });
    return kind ? [{ kind, amountCents: part.amountCents }] : [];
  });
}

function textMatches(tx: Pick<InsightTx, "title" | "merchantName">, re: RegExp): boolean {
  return [tx.title, tx.merchantName].some((t) => !!t && re.test(t.toLowerCase()));
}

// --- Delivery apps ---------------------------------------------------------------------------

/** Restaurant delivery. Not Instacart: that is groceries, where "pick it up yourself" saves little. */
const DELIVERY_APP = /\buber\s*eats\b|\bubereats\b|\bdoordash\b|\bskip ?the ?dishes\b|\bgrubhub\b|\bfantuan\b/;

// --- Bank fees and interest ------------------------------------------------------------------

const FEE_TEXT =
  /\bnsf\b|non-?sufficient|overdraft|\bmonthly (?:account |plan )?fee\b|service charge|\binterest charge|purchase interest|cash advance (?:fee|interest)|foreign (?:transaction|exchange|currency) fee|\bfx fee\b|\bannual fee\b|\blate (?:payment )?fee\b|\batm fee\b|\bnetwork fee\b/;

export function isBankFee(tx: Pick<InsightTx, "title" | "merchantName" | "pfcPrimary">): boolean {
  return tx.pfcPrimary === "BANK_FEES" || textMatches(tx, FEE_TEXT);
}

// --- Streaming and media services ------------------------------------------------------------

export const STREAMING_SERVICES: Array<{ name: string; re: RegExp }> = [
  { name: "Netflix", re: /\bnetflix\b/ },
  { name: "Disney+", re: /\bdisney\s*(?:\+|plus)\b|\bdisneyplus\b/ },
  { name: "Crave", re: /\bcrave\b/ },
  // Not "Amazon Prime": that is mostly a shipping membership, and would make a stack of one.
  { name: "Prime Video", re: /\bprime video\b/ },
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

export function streamingServiceFor(text: string | null | undefined): string | null {
  const lower = (text ?? "").toLowerCase();
  if (!lower) return null;
  return STREAMING_SERVICES.find((s) => s.re.test(lower))?.name ?? null;
}

// --- Categories ------------------------------------------------------------------------------

/**
 * What a category the user named is for, where a detector cares: eating out, groceries, or
 * money put aside. Matched on the name in English and Japanese, the languages of the default
 * categories, and French, which Canadian users often name their own in. Anything else is
 * simply not classified.
 */
export type CategoryRole = "dining" | "grocery" | "savings";

const CATEGORY_ROLES: Array<{ role: CategoryRole; re: RegExp }> = [
  { role: "dining", re: /dining|eating out|restaurant|restos?\b|restauration|take ?out|delivery|fast food|外食/i },
  { role: "grocery", re: /grocer|supermarket|[ée]picerie|alimentation|食費|食料品/i },
  {
    role: "savings",
    re: /saving|invest|transfer|tfsa|rrsp|fhsa|[ée]pargne|placement|\bceli(?:app)?\b|\breer\b|貯金|投資/i,
  },
];

const roleCache = new Map<string, CategoryRole | null>();

export function categoryRole(categoryName: string): CategoryRole | null {
  let role = roleCache.get(categoryName);
  if (role === undefined) {
    role = CATEGORY_ROLES.find((r) => r.re.test(categoryName))?.role ?? null;
    roleCache.set(categoryName, role);
  }
  return role;
}

/** Spend per category for one transaction, with split parts taking over from the parent's. */
export function categoryAmounts(tx: InsightTx): Array<{ categoryId: string; categoryName: string; amountCents: number }> {
  if (tx.splits.length) return tx.splits;
  return [{ categoryId: tx.categoryId, categoryName: tx.categoryName, amountCents: tx.amountCents }];
}
