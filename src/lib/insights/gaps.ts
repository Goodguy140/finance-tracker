import type { AccountType } from "@prisma/client";
import { ymdFromDateUtc } from "@/lib/date-only";
import { CADENCE_BANDS } from "./recurring-detection";
import type { Insight, InsightSeverity, InsightTx } from "./types";
import {
  DAY_MS,
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
 * Spotting stretches of the log that look incomplete: a paycheque, savings transfer or card
 * payment that has arrived on a schedule and then skipped a beat, a month with no income at
 * all, or a busy account that suddenly goes quiet.
 *
 * Pay that is late right now is `changes.ts`'s ("No pay from … since"); here it is only the
 * paycheques missing between two that were logged.
 *
 * None of these prove anything is missing — a job ends, a transfer is paused, a card sits in
 * a drawer. They are prompts to check, and every other insight is only as good as the data
 * underneath it. So, as with recurring detection, a pattern has to be well established before
 * a break in it is worth mentioning, and a series that stopped long ago is taken to have ended.
 */

/** A transfer leg, with what the insight engine needs to work out which way it went. */
export type GapTransferTx = InsightTx & {
  /** The account on the other side, when the user said. */
  transferAccountId: string | null;
  /** True when the other leg is in the log too. */
  paired: boolean;
};

export type GapAccount = {
  id: string;
  name: string;
  type: AccountType | string;
  countsAsSavings: boolean;
};

export type DataGapsInput = {
  /** Income and expenses, as the rest of the engine sees them. */
  txs: InsightTx[];
  transfers: GapTransferTx[];
  /** Active accounts only; anything booked against an archived one is ignored. */
  accounts: GapAccount[];
  now: Date;
  fmt: MoneyFormatter;
};

/** Missed occurrences older than this are history, not something to go and fix. */
export const GAP_LOOKBACK_DAYS = 180;
/** Share of a series' gaps that must be exactly one cycle, and that must be whole cycles. */
const MIN_SINGLE_CYCLE_SHARE = 0.6;
const MIN_WHOLE_CYCLE_SHARE = 0.75;
/** A gap this many cycles long or more is a series that stopped and restarted. */
const MAX_MISSED_CYCLES = 4;

export function detectDataGaps(input: DataGapsInput): Insight[] {
  const series = seriesGapInsights(input);
  const coveredIncomeMonths = new Set(
    series.filter((g) => g.kind === "income").flatMap((g) => g.missed.map((d) => ymOf(d))),
  );
  return [
    ...series.map((g) => g.insight),
    ...incomeMonthGaps(input, coveredIncomeMonths),
    ...quietAccountGaps(input),
  ];
}

// --- Formatting ------------------------------------------------------------------------------

function shortDate(date: Date, now: Date): string {
  return date.toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
  });
}

function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-CA", { timeZone: "UTC", month: "long", year: "numeric" });
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** UTC midnight, so arithmetic on date-only values stays on whole days. */
function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + Math.round(days) * DAY_MS);
}

// --- Scheduled series that skipped a beat ----------------------------------------------------

export type SeriesKind = "income" | "saving" | "card-payment" | "transfer";

type Series = { key: string; kind: SeriesKind; label: string; txs: InsightTx[] };

export type SeriesGap = {
  kind: SeriesKind;
  /** Dates an occurrence was expected and none was logged, oldest first. */
  missed: Date[];
  /** Set when the most recent expected occurrence is the one missing. */
  overdue: boolean;
  insight: Insight;
};

/**
 * Income grouped by who pays it; transfers grouped by which accounts they move between, since
 * their titles are whatever each bank calls them.
 */
function buildSeries({ txs, transfers, accounts }: DataGapsInput): Series[] {
  const byKey = new Map<string, Series>();
  const add = (key: string, kind: SeriesKind, label: string, tx: InsightTx) => {
    const existing = byKey.get(key);
    if (existing) existing.txs.push(tx);
    else byKey.set(key, { key, kind, label, txs: [tx] });
  };

  for (const tx of txs) {
    if (tx.type !== "INCOME" || tx.amountCents <= 0) continue;
    const merchantKey = merchantKeyFor(tx);
    if (merchantKey) add(`income:${merchantKey}`, "income", merchantLabelFor(tx), tx);
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const tx of transfers) {
    // Both legs of a paired transfer are one movement: count the one that left.
    if (tx.paired && tx.amountCents < 0) continue;
    const outgoing = tx.amountCents >= 0;
    const fromId = outgoing ? tx.accountId : tx.transferAccountId;
    const toId = outgoing ? tx.transferAccountId : tx.accountId;
    const from = fromId ? accountById.get(fromId) : undefined;
    const to = toId ? accountById.get(toId) : undefined;
    // An archived account stopping is expected, not a gap.
    if ((fromId && !from) || (toId && !to)) continue;

    let key = `${fromId ?? "?"}>${toId ?? "?"}`;
    if (!from || !to) {
      // One side unknown: the title is all that tells one such series from another.
      const merchantKey = merchantKeyFor(tx);
      if (!merchantKey) continue;
      key += `:${merchantKey}`;
    }
    if (to && to.countsAsSavings && !from?.countsAsSavings) {
      add(`saving:${key}`, "saving", `Savings transfers to ${to.name}`, tx);
    } else if (to && to.type === "CREDIT_CARD") {
      add(`card-payment:${key}`, "card-payment", `Payments to ${to.name}`, tx);
    } else if (from && to) {
      add(`transfer:${key}`, "transfer", `Transfers from ${from.name} to ${to.name}`, tx);
    } else {
      add(`transfer:${key}`, "transfer", merchantLabelFor(tx) || "A regular transfer", tx);
    }
  }
  return [...byKey.values()];
}

export type SeriesSchedule = {
  typicalDays: number;
  /** Expected dates with nothing logged, oldest first, within the lookback. */
  missed: Date[];
  overdue: boolean;
};

/**
 * Where a regular series has holes. A gap of two or three cycles means one or two occurrences
 * were never logged; a series past its next due date (with some grace) is missing the latest
 * one, unless it is so far past that it has simply ended.
 */
export function findScheduleGaps(dates: Date[], now: Date): SeriesSchedule | null {
  const days = [...new Set(dates.map((d) => startOfDayUtc(d).getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
  if (days.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));

  const mid = median(gaps);
  const band = CADENCE_BANDS.find((b) => mid >= b.minDays && mid <= b.maxDays);
  if (!band) return null;
  const fits = (gap: number, cycles: number) => gap >= band.minDays * cycles && gap <= band.maxDays * cycles;

  let single = 0;
  let whole = 0;
  const missedCycles: Array<{ after: Date; cycles: number }> = [];
  for (let i = 0; i < gaps.length; i++) {
    if (fits(gaps[i], 1)) {
      single++;
      whole++;
      continue;
    }
    if (i + 1 < gaps.length && fits(gaps[i] + gaps[i + 1], 2)) {
      // One that landed late (or early) skews both gaps around it; nothing is missing.
      single += 2;
      whole += 2;
      i++;
      continue;
    }
    const cycles = Math.round(gaps[i] / band.typicalDays);
    if (cycles >= 2 && cycles < MAX_MISSED_CYCLES && fits(gaps[i], cycles)) {
      whole++;
      missedCycles.push({ after: days[i], cycles });
    }
  }
  if (single < band.minCount) return null;
  if (single / gaps.length < MIN_SINGLE_CYCLE_SHARE || whole / gaps.length < MIN_WHOLE_CYCLE_SHARE) return null;

  const today = startOfDayUtc(now);
  const since = addDays(today, -GAP_LOOKBACK_DAYS);
  const missed: Date[] = [];
  for (const { after, cycles } of missedCycles) {
    for (let j = 1; j < cycles; j++) missed.push(addDays(after, band.typicalDays * j));
  }

  const last = days[days.length - 1];
  const sinceLast = daysBetween(last, today);
  const grace = Math.max(band.typicalDays * 1.5, band.typicalDays + 5);
  const endedAfter = Math.max(band.typicalDays * MAX_MISSED_CYCLES, 60);
  let overdue = false;
  if (sinceLast > endedAfter) {
    // Stopped a while ago: a job that ended, a transfer that was cancelled. Earlier holes in
    // it are no longer worth chasing either.
    return null;
  }
  if (sinceLast > grace) {
    overdue = true;
    for (let next = addDays(last, band.typicalDays); next <= addDays(today, -(grace - band.typicalDays)); next = addDays(next, band.typicalDays)) {
      missed.push(next);
    }
  }
  const recent = missed.filter((d) => d >= since);
  if (recent.length === 0) return null;
  return { typicalDays: band.typicalDays, missed: recent, overdue };
}

const CADENCE_WORDS: Array<{ days: number; words: string }> = [
  { days: 7, words: "every week" },
  { days: 14, words: "every two weeks" },
  { days: 30.4, words: "every month" },
  { days: 91, words: "every three months" },
  { days: 365, words: "every year" },
];

const SERIES_ADVICE: Record<SeriesKind, string> = {
  income: "If it arrived, adding it keeps your income, savings rate and score right.",
  saving: "If the money moved, logging it keeps what you have saved up to date.",
  "card-payment": "If the payment was made, logging it keeps the card's balance right.",
  transfer: "If it went through, logging it keeps both accounts' balances right.",
};

function seriesGapInsights(input: DataGapsInput): SeriesGap[] {
  const { now, fmt } = input;
  const out: SeriesGap[] = [];
  for (const series of buildSeries(input)) {
    const schedule = findScheduleGaps(series.txs.map((tx) => tx.date), now);
    if (!schedule) continue;
    const { typicalDays } = schedule;
    const last = [...series.txs].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    // Late pay is already said by `pay:missed`; only the holes before the latest pay are new.
    const leaveToChanges = series.kind === "income" && schedule.overdue;
    const missed = leaveToChanges ? schedule.missed.filter((d) => d < last.date) : schedule.missed;
    if (missed.length === 0) continue;
    const overdue = schedule.overdue && !leaveToChanges;
    const typicalCents = median(series.txs.map((tx) => Math.abs(tx.amountCents)));
    const cadence = CADENCE_WORDS.find((c) => c.days === typicalDays)?.words ?? "regularly";
    const shown = missed.slice(-3).map((d) => shortDate(d, now));
    const latestMissed = missed[missed.length - 1];

    const recentlyMissed = daysBetween(latestMissed, now) <= 60;
    const severity: InsightSeverity =
      series.kind === "income"
        ? recentlyMissed
          ? "high"
          : "medium"
        : series.kind === "transfer"
          ? "low"
          : "medium";

    const verb = series.kind === "income" ? "arrives" : "goes through";
    const usual = `${series.label} usually ${verb} ${cadence}, about ${fmt(typicalCents)} each time`;
    const what = series.kind === "income" ? "nothing was logged" : "none was logged";
    const title = overdue
      ? `${series.label}: nothing logged since ${shortDate(last.date, now)}`
      : `${series.label}: ${missed.length === 1 ? "one looks" : `${missed.length} look`} missing`;
    const body = overdue
      ? `${usual}, and the next was expected around ${shortDate(missed[0], now)}. ${SERIES_ADVICE[series.kind]} If it has stopped, dismiss this.`
      : `${usual}, but ${what} around ${listWords(shown)}${missed.length > shown.length ? " and earlier" : ""}. ${SERIES_ADVICE[series.kind]}`;

    out.push({
      kind: series.kind,
      missed,
      overdue,
      insight: {
        // The missed date is part of the key: dismissing one hole should not hide the next.
        key: `gap:${series.key}:${ymdFromDateUtc(latestMissed)}`,
        section: "gap",
        severity,
        title,
        body,
        evidenceTxIds: evidenceIds(series.txs, 6),
        action:
          series.kind === "income"
            ? { kind: "link", href: `/?month=${ymOf(latestMissed)}`, label: "Open that month" }
            : { kind: "link", href: "/settings/import", label: "Import transactions" },
      },
    });
  }
  return out;
}

// --- Months with no income at all ------------------------------------------------------------

const INCOME_MONTH_WINDOW = 12;
const INCOME_MONTH_RECENT = 6;
/** Share of the months since income was first logged that must have some. */
const MIN_INCOME_MONTH_SHARE = 0.75;

/**
 * A recent full month with no income at all, for someone whose log normally has some every
 * month. Catches irregular income the series check cannot see: freelance invoices, a second
 * job, benefits. Months already explained by a missed paycheque are left to that insight.
 */
function incomeMonthGaps({ txs, now }: DataGapsInput, covered: Set<string>): Insight[] {
  const months = previousFullMonths(now, INCOME_MONTH_WINDOW);
  const withIncome = new Set(
    txs.filter((tx) => tx.type === "INCOME" && tx.amountCents > 0).map((tx) => ymOf(tx.date)),
  );
  const first = months.findIndex((ym) => withIncome.has(ym));
  if (first < 0) return [];
  const span = months.slice(first);
  const count = span.filter((ym) => withIncome.has(ym)).length;
  if (count < 3 || count / span.length < MIN_INCOME_MONTH_SHARE) return [];

  const recent = new Set(months.slice(-INCOME_MONTH_RECENT));
  const empty = span.filter((ym) => recent.has(ym) && !withIncome.has(ym) && !covered.has(ym));
  if (empty.length === 0) return [];

  const names = empty.map(monthName);
  const neighbours = txs.filter(
    (tx) => tx.type === "INCOME" && tx.amountCents > 0 && Math.abs(daysBetween(tx.date, startOfMonth(empty[0]))) <= 45,
  );
  return [
    {
      key: `gap:income-month:${empty.join(",")}`,
      section: "gap",
      severity: "medium",
      title: empty.length === 1 ? `No income logged in ${names[0]}` : `No income logged in ${empty.length} recent months`,
      body:
        `${listWords(names)} ${empty.length === 1 ? "has" : "have"} no income at all, while ${count} of the last ` +
        `${span.length} months do. If money came in, adding it keeps your savings rate and score from reading low.`,
      evidenceTxIds: evidenceIds(neighbours, 6),
      action: { kind: "link", href: `/?month=${empty[empty.length - 1]}`, label: "Open that month" },
    },
  ];
}

function startOfMonth(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

// --- Busy accounts that went quiet -----------------------------------------------------------

/** Enough history for "usually" to mean something. */
const QUIET_MIN_ENTRIES = 20;
const QUIET_MIN_SPAN_DAYS = 90;
/** Only accounts used at least about weekly; a savings account is quiet by nature. */
const QUIET_MAX_MEDIAN_GAP_DAYS = 7;
const QUIET_MIN_GAP_DAYS = 21;
const QUIET_GAP_FACTOR = 6;
/** Silent longer than this and the account has most likely been retired. */
const QUIET_ENDED_DAYS = 120;

export type QuietStretch = { from: Date; to: Date | null; days: number; perMonth: number };

/**
 * The most recent unusually long silence in an account's entries, if any: between two entries
 * (`to` set), or since the last one (`to` null).
 */
export function findQuietStretch(dates: Date[], now: Date): QuietStretch | null {
  const days = [...new Set(dates.map((d) => startOfDayUtc(d).getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
  if (dates.length < QUIET_MIN_ENTRIES || days.length < 2) return null;
  const today = startOfDayUtc(now);
  const span = daysBetween(days[0], days[days.length - 1]);
  if (span < QUIET_MIN_SPAN_DAYS) return null;

  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  const usualGap = median(gaps);
  if (usualGap > QUIET_MAX_MEDIAN_GAP_DAYS) return null;
  const threshold = Math.max(QUIET_MIN_GAP_DAYS, Math.ceil(usualGap * QUIET_GAP_FACTOR));
  const perMonth = Math.round((dates.length / Math.max(span, 1)) * 30.4);

  const sinceLast = daysBetween(days[days.length - 1], today);
  if (sinceLast > QUIET_ENDED_DAYS) return null;
  if (sinceLast >= threshold) return { from: days[days.length - 1], to: null, days: sinceLast, perMonth };

  const since = addDays(today, -GAP_LOOKBACK_DAYS);
  for (let i = gaps.length - 1; i >= 0; i--) {
    if (days[i + 1] < since) break;
    if (gaps[i] >= threshold) return { from: days[i], to: days[i + 1], days: gaps[i], perMonth };
  }
  return null;
}

function quietAccountGaps({ txs, transfers, accounts, now }: DataGapsInput): Insight[] {
  const byAccount = new Map<string, InsightTx[]>();
  for (const tx of [...txs, ...transfers]) {
    if (!tx.accountId) continue;
    const list = byAccount.get(tx.accountId);
    if (list) list.push(tx);
    else byAccount.set(tx.accountId, [tx]);
  }

  const out: Insight[] = [];
  for (const account of accounts) {
    const entries = byAccount.get(account.id) ?? [];
    const stretch = findQuietStretch(entries.map((tx) => tx.date), now);
    if (!stretch) continue;
    const from = shortDate(stretch.from, now);
    const around = entries.filter(
      (tx) =>
        Math.abs(daysBetween(tx.date, stretch.from)) <= 14 ||
        (stretch.to !== null && Math.abs(daysBetween(tx.date, stretch.to)) <= 14),
    );
    out.push({
      key: `gap:quiet:${account.id}:${ymdFromDateUtc(stretch.from)}`,
      section: "gap",
      severity: stretch.to === null ? "high" : "medium",
      title:
        stretch.to === null
          ? `Nothing logged for ${account.name} since ${from}`
          : `Nothing logged for ${account.name} from ${from} to ${shortDate(stretch.to, now)}`,
      body:
        `${account.name} usually has about ${stretch.perMonth} entries a month, but ${stretch.days} days went by with none. ` +
        `A skipped statement or a paused bank connection looks like this; importing it fills the gap.`,
      evidenceTxIds: evidenceIds(around, 6),
      action: { kind: "link", href: "/settings/import", label: "Import transactions" },
    });
  }
  return out;
}
