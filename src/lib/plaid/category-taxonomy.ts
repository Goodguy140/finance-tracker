import { CategoryKind } from "@prisma/client";

/**
 * Plaid's personal_finance_category taxonomy, as far as category mapping needs it.
 *
 * TRANSFER_IN, TRANSFER_OUT and LOAN_PAYMENTS_CREDIT_CARD_PAYMENT are absent: those rows are
 * staged as transfers (`isPlaidTransfer`), which have one category of their own, so there is
 * nothing for the user to map them to.
 *
 * A detailed code Plaid adds later and this list lacks still works: it falls back to its
 * primary's mapping, which is what it did before mappings existed.
 */
export type PlaidCategoryGroup = {
  primary: string;
  /** Which kind of category rows under this code are booked as. */
  kind: CategoryKind;
  detailed: string[];
};

const group = (primary: string, kind: CategoryKind, suffixes: string[]): PlaidCategoryGroup => ({
  primary,
  kind,
  detailed: suffixes.map((suffix) => `${primary}_${suffix}`),
});

const E = CategoryKind.EXPENSE;

export const PLAID_CATEGORY_TAXONOMY: PlaidCategoryGroup[] = [
  group("INCOME", CategoryKind.INCOME, [
    "DIVIDENDS",
    "INTEREST_EARNED",
    "RETIREMENT_PENSION",
    "TAX_REFUND",
    "UNEMPLOYMENT",
    "WAGES",
    "OTHER_INCOME",
  ]),
  group("FOOD_AND_DRINK", E, [
    "BEER_WINE_AND_LIQUOR",
    "COFFEE",
    "FAST_FOOD",
    "GROCERIES",
    "RESTAURANT",
    "VENDING_MACHINES",
    "OTHER_FOOD_AND_DRINK",
  ]),
  group("GENERAL_MERCHANDISE", E, [
    "BOOKSTORES_AND_NEWSSTANDS",
    "CLOTHING_AND_ACCESSORIES",
    "CONVENIENCE_STORES",
    "DEPARTMENT_STORES",
    "DISCOUNT_STORES",
    "ELECTRONICS",
    "GIFTS_AND_NOVELTIES",
    "OFFICE_SUPPLIES",
    "ONLINE_MARKETPLACES",
    "PET_SUPPLIES",
    "SPORTING_GOODS",
    "SUPERSTORES",
    "TOBACCO_AND_VAPE",
    "OTHER_GENERAL_MERCHANDISE",
  ]),
  group("RENT_AND_UTILITIES", E, [
    "GAS_AND_ELECTRICITY",
    "INTERNET_AND_CABLE",
    "RENT",
    "SEWAGE_AND_WASTE_MANAGEMENT",
    "TELEPHONE",
    "WATER",
    "OTHER_UTILITIES",
  ]),
  group("TRANSPORTATION", E, [
    "BIKES_AND_SCOOTERS",
    "GAS",
    "PARKING",
    "PUBLIC_TRANSIT",
    "TAXIS_AND_RIDE_SHARES",
    "TOLLS",
    "OTHER_TRANSPORTATION",
  ]),
  group("TRAVEL", E, ["FLIGHTS", "LODGING", "RENTAL_CARS", "OTHER_TRAVEL"]),
  group("MEDICAL", E, [
    "DENTAL_CARE",
    "EYE_CARE",
    "NURSING_CARE",
    "PHARMACIES_AND_SUPPLEMENTS",
    "PRIMARY_CARE",
    "VETERINARY_SERVICES",
    "OTHER_MEDICAL",
  ]),
  group("PERSONAL_CARE", E, [
    "GYMS_AND_FITNESS_CENTERS",
    "HAIR_AND_BEAUTY",
    "LAUNDRY_AND_DRY_CLEANING",
    "OTHER_PERSONAL_CARE",
  ]),
  group("ENTERTAINMENT", E, [
    "CASINOS_AND_GAMBLING",
    "MUSIC_AND_AUDIO",
    "SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    "TV_AND_MOVIES",
    "VIDEO_GAMES",
    "OTHER_ENTERTAINMENT",
  ]),
  group("GENERAL_SERVICES", E, [
    "ACCOUNTING_AND_FINANCIAL_PLANNING",
    "AUTOMOTIVE",
    "CHILDCARE",
    "CONSULTING_AND_LEGAL",
    "EDUCATION",
    "INSURANCE",
    "POSTAGE_AND_SHIPPING",
    "STORAGE",
    "OTHER_GENERAL_SERVICES",
  ]),
  group("HOME_IMPROVEMENT", E, ["FURNITURE", "HARDWARE", "REPAIR_AND_MAINTENANCE", "SECURITY", "OTHER_HOME_IMPROVEMENT"]),
  group("BANK_FEES", E, [
    "ATM_FEES",
    "FOREIGN_TRANSACTION_FEES",
    "INSUFFICIENT_FUNDS",
    "INTEREST_CHARGE",
    "OVERDRAFT_FEES",
    "OTHER_BANK_FEES",
  ]),
  group("LOAN_PAYMENTS", E, [
    "CAR_PAYMENT",
    "PERSONAL_LOAN_PAYMENT",
    "MORTGAGE_PAYMENT",
    "STUDENT_LOAN_PAYMENT",
    "OTHER_PAYMENT",
  ]),
  group("GOVERNMENT_AND_NON_PROFIT", E, [
    "DONATIONS",
    "GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
    "TAX_PAYMENT",
    "OTHER_GOVERNMENT_AND_NON_PROFIT",
  ]),
];

const KNOWN_CODES = new Set(PLAID_CATEGORY_TAXONOMY.flatMap((g) => [g.primary, ...g.detailed]));

/** Whether `code` is one this app lets the user map. */
export function isMappablePlaidCategory(code: string): boolean {
  return KNOWN_CODES.has(code);
}

/** The primary a mappable code belongs to; undefined for an unknown code. */
export function plaidCategoryGroupOf(code: string): PlaidCategoryGroup | undefined {
  return PLAID_CATEGORY_TAXONOMY.find((g) => g.primary === code || g.detailed.includes(code));
}

const WORD_OVERRIDES: Record<string, string> = { ATM: "ATM", TV: "TV", AND: "and" };

/** "FOOD_AND_DRINK_FAST_FOOD" under FOOD_AND_DRINK → "Fast food"; a primary → "Food and drink". */
export function plaidCategoryLabel(code: string, primary?: string): string {
  const rest = primary && code.startsWith(`${primary}_`) ? code.slice(primary.length + 1) : code;
  const words = rest.split("_").filter(Boolean);
  return words
    .map((word, index) => {
      const override = WORD_OVERRIDES[word];
      if (override) return index === 0 && override === "and" ? "And" : override;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/**
 * Plaid's detailed code in its canonical form. Real responses carry the primary as a prefix
 * ("FOOD_AND_DRINK_GROCERIES"); some fixtures send only the suffix ("GROCERIES"), which is
 * read the same way so a mapping cannot silently miss.
 */
export function canonicalDetailedCode(primary: string, detailed: string | null | undefined): string {
  const code = (detailed ?? "").trim().toUpperCase();
  if (!code || !primary) return code;
  return code.startsWith(`${primary}_`) ? code : `${primary}_${code}`;
}
