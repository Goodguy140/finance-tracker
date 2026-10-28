import { parseAmountQuery } from "@/lib/search/search-paths";

/**
 * Type-to-add in the master search: "12.50 tim hortons yesterday" read as an expense of
 * $12.50 titled "Tim Hortons" on yesterday's date. Pure, so the palette's preview and the
 * action that saves it read the text the same way; the server does both, in the user's own
 * time zone.
 *
 * It takes exactly one amount, a title with at least one letter, and at most one date. Anything
 * else is not offered, so an ordinary search ("tim hortons", "12.50", "oct 27") never turns into
 * an add.
 */

export type QuickAddEntry = {
  amountCents: number;
  title: string;
  dateYmd: string;
};

/** Longer than any expense title the Add card takes is not something to add. */
const MAX_TITLE_LENGTH = 120;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** A whole name, or one cut short to three letters or more: "oct", "sept", "october". */
function nameIndex(names: readonly string[], raw: string): number {
  const word = raw.toLowerCase().replace(/\.$/, "");
  if (word.length < 3) return -1;
  return names.findIndex((name) => name.startsWith(word));
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(ymdString: string): Date {
  return new Date(`${ymdString}T00:00:00.000Z`);
}

function addDays(ymdString: string, days: number): string {
  const d = utcDate(ymdString);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** A real calendar day, or null for "feb 30". */
function calendarDay(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day ? ymd(d) : null;
}

/**
 * A month and day with no year: this year's, unless that is still ahead, then last year's.
 * Expenses are logged after they happen, so "dec 30" typed in January means the one just gone.
 */
function pastMonthDay(todayYmd: string, month: number, day: number): string | null {
  const year = Number(todayYmd.slice(0, 4));
  const thisYear = calendarDay(year, month, day);
  if (thisYear && thisYear <= todayYmd) return thisYear;
  return calendarDay(year - 1, month, day);
}

type DateMatch = { dateYmd: string; length: number };

/** A date at `tokens[i]`, one or two words long. */
function dateAt(tokens: string[], i: number, todayYmd: string): DateMatch | null {
  const word = tokens[i].toLowerCase().replace(/,$/, "");
  if (word === "today") return { dateYmd: todayYmd, length: 1 };
  if (word === "yesterday") return { dateYmd: addDays(todayYmd, -1), length: 1 };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
  if (iso) {
    const day = calendarDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return day ? { dateYmd: day, length: 1 } : null;
  }
  // Whole names only: "Sun Life" or "Wed dinner" is a title, not a date.
  const weekday = WEEKDAYS.indexOf(word);
  if (weekday >= 0) {
    // The most recent one, today included.
    const back = (utcDate(todayYmd).getUTCDay() - weekday + 7) % 7;
    return { dateYmd: addDays(todayYmd, -back), length: 1 };
  }
  const next = tokens[i + 1]?.toLowerCase().replace(/,$/, "");
  const month = nameIndex(MONTHS, word);
  if (month >= 0 && next && /^\d{1,2}$/.test(next)) {
    const day = pastMonthDay(todayYmd, month, Number(next));
    return day ? { dateYmd: day, length: 2 } : null;
  }
  if (/^\d{1,2}$/.test(word) && next && nameIndex(MONTHS, next) >= 0) {
    const day = pastMonthDay(todayYmd, nameIndex(MONTHS, next), Number(word));
    return day ? { dateYmd: day, length: 2 } : null;
  }
  return null;
}

/** "tim hortons" → "Tim Hortons"; words with capitals of their own ("IKEA", "McDonald's") stay. */
function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function parseQuickAdd(raw: string, todayYmd: string): QuickAddEntry | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let date: DateMatch | null = null;
  let dateIndex = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const found = dateAt(tokens, i, todayYmd);
    if (!found) continue;
    if (date) return null;
    date = found;
    dateIndex = i;
    i += found.length - 1;
  }
  if (date && date.dateYmd > todayYmd) return null;

  const rest = tokens.filter((_, i) => !date || i < dateIndex || i >= dateIndex + date.length);
  const amounts = rest.map((token) => (/^\$?\d[\d,]*(\.\d{1,2})?\$?$/.test(token) ? parseAmountQuery(token.replace(/\$$/, "")) : null));
  const candidates = amounts.flatMap((cents, i) => (cents === null ? [] : [i]));
  // "2 coffees 9.50": a number written as money wins over a bare count.
  const asMoney = candidates.filter((i) => /[.$]/.test(rest[i]));
  const amountAt = asMoney.length === 1 ? asMoney[0] : candidates.length === 1 ? candidates[0] : -1;
  if (amountAt < 0) return null;

  const title = rest
    .filter((_, i) => i !== amountAt)
    .join(" ")
    .trim();
  if (!/\p{L}/u.test(title) || title.length > MAX_TITLE_LENGTH) return null;

  return { amountCents: amounts[amountAt]!, title: titleCase(title), dateYmd: date?.dateYmd ?? todayYmd };
}
