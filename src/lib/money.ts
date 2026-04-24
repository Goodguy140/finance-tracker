export function toCents(amount: number) {
  return Math.round(amount * 100);
}

function toAsciiDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

/**
 * Parses amounts from bank CSVs / statements: negatives as `-12.34` or `(12.34)`,
 * optional thousands separators, full-width digits.
 */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim().replace(/[$\s\u00a0\u3000]/g, "");
  if (!s) return null;
  s = s.replace(/\u2212/g, "-");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  s = toAsciiDigits(s).replace(/．/g, ".");
  s = s.replace(/,/g, "");
  if (s.endsWith("-")) {
    sign *= -1;
    s = s.slice(0, -1).trim();
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return sign * n;
}

export function fromCents(cents: number) {
  return cents / 100;
}

export function formatCurrency(cents: number, currency = "CAD", locale = "en-CA") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(fromCents(cents));
}
