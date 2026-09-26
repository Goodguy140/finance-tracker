import type { HabitKind } from "./types";

/**
 * What marks a purchase as habit spending: merchant/title words, Plaid's detailed category,
 * and the name of a category the user filed it under themselves.
 *
 * Deliberately narrow. Convenience stores and bars sell these things too but mostly sell
 * other things, so they are not matched — a false flag on something this personal costs more
 * trust than a miss does. Everything is matched against lowercased text with word boundaries,
 * so "weed" does not fire on "Tweed Heads" and "saq" does not fire inside a longer word.
 */
export type HabitPattern = {
  kind: HabitKind;
  label: string;
  /** Lowercased title / merchant / note is tested against each. */
  text: RegExp[];
  /** Plaid `personal_finance_category.detailed` codes. */
  pfcDetailed: string[];
  /** Tested against the user's own category name. */
  categoryName: RegExp | null;
  /** Flag at this many purchases, or this much spend, in the window. */
  minCount: number;
  minCents: number;
};

/**
 * Order matters: a transaction is attributed to the first kind it matches. Cannabis comes
 * before tobacco so "Tokyo Smoke" (a cannabis retailer) is not read as a smoke shop.
 */
export const HABIT_PATTERNS: HabitPattern[] = [
  {
    kind: "CANNABIS",
    label: "Cannabis",
    text: [
      /\bcannabis\b/,
      /\bmarijuana\b/,
      /\bdispensary\b/,
      /\bsqdc\b/,
      /\bocs\b/,
      /\btokyo smoke\b/,
      /\bspiritleaf\b/,
      /\bfire (?:&|and) flower\b/,
      /\bcanna cabana\b/,
      /\bvalue buds\b/,
      /\bhigh tide\b/,
      /\bnova cannabis\b/,
      /\bone plant\b/,
      // "Weed Man" is a lawn-care franchise.
      /\bweed\b(?!\s*man)/,
    ],
    pfcDetailed: [],
    categoryName: /\b(cannabis|weed|marijuana)\b/,
    minCount: 3,
    minCents: 5_000,
  },
  {
    kind: "TOBACCO_VAPE",
    label: "Tobacco & vaping",
    text: [
      /\btobacco(?:nist)?\b/,
      /\bcigar(?:ette)?s?\b/,
      /\bvap(?:e|es|ing|or|our)\b/,
      /\bsmoke shop\b/,
      /\bsmoke (?:&|and) vape\b/,
      /\bjuul\b/,
      /\biqos\b/,
      /\bzyn\b/,
    ],
    pfcDetailed: ["GENERAL_MERCHANDISE_TOBACCO_AND_VAPE"],
    categoryName: /\b(tobacco|smokes?|smoking|cigarettes?|vap(?:e|ing))\b/,
    minCount: 3,
    minCents: 5_000,
  },
  {
    kind: "ALCOHOL",
    label: "Alcohol",
    text: [
      /\blcbo\b/,
      /\bsaq\b/,
      /\bbc liquor\b/,
      /\bliquor\b/,
      /\bbeer store\b/,
      /\bwine rack\b/,
      /\bwine shop\b/,
      /\bnslc\b/,
    ],
    pfcDetailed: ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"],
    categoryName: /\b(alcohol|liquor|booze)\b/,
    minCount: 3,
    minCents: 5_000,
  },
  {
    kind: "GAMBLING",
    label: "Gambling",
    text: [
      /\bcasino\b/,
      /\blotto\b/,
      /\blottery\b/,
      /\bolg\b/,
      /\bloto[- ]?qu[eé]bec\b/,
      /\bplaynow\b/,
      /\bproline\b/,
      /\bbet ?99\b/,
      /\bbet ?365\b/,
      /\bbetmgm\b/,
      /\bbetway\b/,
      /\bbetrivers\b/,
      /\bpointsbet\b/,
      /\bfanduel\b/,
      /\bdraftkings\b/,
      /\bpokerstars\b/,
      /\bthescore bet\b/,
      /\bsports interaction\b/,
      /\bbingo\b/,
    ],
    pfcDetailed: ["ENTERTAINMENT_CASINOS_AND_GAMBLING"],
    categoryName: /\b(gambling|casino|betting|lotto|lottery)\b/,
    // Gambling losses compound quickly; two deposits in three months is already a pattern.
    minCount: 2,
    minCents: 5_000,
  },
  {
    kind: "GAMING_PURCHASES",
    label: "In-game purchases",
    text: [
      /\broblox\b/,
      /\bv-?bucks\b/,
      /\bfortnite\b/,
      /\bxsolla\b/,
      /\bhoyoverse\b/,
      /\bmihoyo\b/,
      /\bsupercell\b/,
      /\bcandy crush\b/,
      /\bking\.com\b/,
      /\bin-?game\b/,
      /\bmicrotransactions?\b/,
    ],
    pfcDetailed: [],
    categoryName: /\b(in-?game|microtransactions?)\b/,
    // Buying a game now and then is a hobby; the flag is for a steady drip.
    minCount: 5,
    minCents: 7_500,
  },
];

export const HABIT_LABELS: Record<HabitKind, string> = Object.fromEntries(
  HABIT_PATTERNS.map((p) => [p.kind, p.label]),
) as Record<HabitKind, string>;

/** Default name of the category "Track separately" files these purchases under. */
export const HABIT_CATEGORY_NAMES: Record<HabitKind, string> = {
  CANNABIS: "Cannabis",
  TOBACCO_VAPE: "Tobacco & Vaping",
  ALCOHOL: "Alcohol",
  GAMBLING: "Gambling",
  GAMING_PURCHASES: "In-game Purchases",
};

export function isHabitKind(value: string): value is HabitKind {
  return value in HABIT_CATEGORY_NAMES;
}

export type HabitMatch = {
  kind: HabitKind;
  /** The words that matched, when it was the text that did — what a rule can look for. */
  matchedText: string | null;
};

export function matchHabit(input: {
  texts: Array<string | null | undefined>;
  pfcDetailed?: string | null;
  categoryName?: string | null;
}): HabitMatch | null {
  const texts = input.texts.filter((t): t is string => !!t).map((t) => t.toLowerCase());
  const category = input.categoryName?.toLowerCase() ?? "";
  for (const pattern of HABIT_PATTERNS) {
    for (const text of texts) {
      for (const re of pattern.text) {
        const m = re.exec(text);
        if (m) return { kind: pattern.kind, matchedText: m[0] };
      }
    }
    if (input.pfcDetailed && pattern.pfcDetailed.includes(input.pfcDetailed)) return { kind: pattern.kind, matchedText: null };
    if (pattern.categoryName && category && pattern.categoryName.test(category)) return { kind: pattern.kind, matchedText: null };
  }
  return null;
}

export function matchHabitKind(input: Parameters<typeof matchHabit>[0]): HabitKind | null {
  return matchHabit(input)?.kind ?? null;
}
