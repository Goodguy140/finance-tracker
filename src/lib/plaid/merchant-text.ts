/**
 * Cleaning up the noise banks staple onto a transaction description.
 *
 * Two consumers with different needs: the matcher wants a comparable key (`normalizeMerchant`),
 * and the review queue wants something presentable (`titleCaseMerchant`). Both want the same
 * noise gone, so the stripping lives here once.
 */

/** Payment-processor prefixes banks staple onto a merchant name. */
const PROCESSOR_PREFIXES = [
  /^sq\s*\*/,
  /^tst\s*\*/,
  /^sp\s+/,
  /^amzn\s+mktp\s*/,
  /^amzn\s*\*/,
  /^paypal\s*\*/,
  /^ppl\s*\*/,
];

/** Network and channel noise that says nothing about which merchant it was. */
const NOISE_WORDS =
  /\b(pos|purchase|debit|credit|visa|mastercard|mc|interac|e-?transfer|etransfer|payment|pmt|recurring|autopay|withdrawal|deposit)\b/g;

/**
 * Reduces a bank description to something comparable.
 *
 * Bank descriptions are noisy in consistent ways — a processor prefix, a store number, a
 * city and province tail, network words. Stripping them is what lets "SQ *BLUE BOTTLE
 * #412 TORONTO ON" and a user's "Blue Bottle" recognise each other.
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  let s = (raw ?? "").toLowerCase().trim();
  if (!s) return "";

  for (const prefix of PROCESSOR_PREFIXES) s = s.replace(prefix, " ");

  s = s.replace(/#\s*\d+/g, " "); // store numbers: "#412"
  // Processor reference codes after a "*" — "CA*2X4TR". Required to contain a digit so a
  // genuine name survives: "FOO*BLUE BOTTLE" keeps "blue bottle".
  s = s.replace(/\*\s*[a-z0-9]*\d[a-z0-9]*/g, " ");
  s = s.replace(NOISE_WORDS, " ");
  // Trailing "CITY ON" / "CITY, ON" province tails (Canadian and US two-letter codes).
  // Never applied when it would consume the whole name: "AMZN MKTP CA" should keep "ca"
  // rather than normalise to nothing, which would silently match every other empty name.
  const withoutTail = s.replace(/[\s,]+[a-z]{2}\s*$/, " ");
  if (withoutTail.trim()) s = withoutTail;
  s = s.replace(/[^a-z0-9]+/g, " "); // punctuation to space
  s = s.replace(/\b\d{3,}\b/g, " "); // long digit runs: reference numbers
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The same cleanup, capitalised for display.
 *
 * Banks send descriptions in caps, so the stripped form is title-cased to sit alongside
 * Plaid's own `merchant_name` values ("Blue Bottle Coffee") without looking shouted.
 */
export function titleCaseMerchant(raw: string | null | undefined): string {
  const stripped = normalizeMerchant(raw);
  if (!stripped) return "";
  return stripped
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
