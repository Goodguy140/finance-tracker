import { dateFromYmd } from "@/lib/date-only";

/**
 * Credit card terms: the limit, for utilization (what is owed as a share of the limit), and the
 * day of the month the payment is due.
 *
 * Utilization is the part of a credit score a person controls most directly; lenders and the
 * Canadian bureaus read anything over about 30% as a sign of strain, so that is where it is
 * flagged.
 */

export const HIGH_UTILIZATION_PCT = 30;

export type Utilization = { pct: number; high: boolean };

/**
 * What is owed as a whole percentage of the limit; null without a limit or a balance. A card in
 * credit (a negative balance) is at 0%.
 */
export function cardUtilization(owedCents: number | null | undefined, limitCents: number | null | undefined): Utilization | null {
  if (owedCents == null || limitCents == null || limitCents <= 0) return null;
  const pct = Math.round((Math.max(0, owedCents) / limitCents) * 100);
  return { pct, high: pct > HIGH_UTILIZATION_PCT };
}

/**
 * Utilization across every card with a limit and a balance: total owed over total limit, the
 * figure a bureau reads alongside each card's own. Null when no card has both.
 */
export function totalUtilization(
  rows: ReadonlyArray<{ latest: { cents: number } | null; creditLimitCents?: number | null }>,
): Utilization | null {
  let owed = 0;
  let limit = 0;
  for (const row of rows) {
    if (!row.latest || row.creditLimitCents == null || row.creditLimitCents <= 0) continue;
    owed += Math.max(0, row.latest.cents);
    limit += row.creditLimitCents;
  }
  return limit > 0 ? cardUtilization(owed, limit) : null;
}

/** A due day typed as 1–31; blank is null. Anything else is refused. */
export function parseDueDayInput(raw: string | null | undefined): number | null | "invalid" {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (!/^\d{1,2}$/.test(trimmed)) return "invalid";
  const day = Number.parseInt(trimmed, 10);
  return day >= 1 && day <= 31 ? day : "invalid";
}

function dueInMonth(year: number, monthIndex: number, dueDay: number): Date {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(dueDay, last)));
}

/** The next due date on or after `todayYmd`; a day past the month's end falls on its last day. */
export function nextDueDate(dueDay: number, todayYmd: string): Date {
  const today = dateFromYmd(todayYmd);
  const thisMonth = dueInMonth(today.getUTCFullYear(), today.getUTCMonth(), dueDay);
  if (thisMonth >= today) return thisMonth;
  return dueInMonth(today.getUTCFullYear(), today.getUTCMonth() + 1, dueDay);
}

export type CardTerms = {
  id: string;
  name: string;
  paymentDueDay: number | null;
  minimumPaymentCents: number | null;
  /** Latest reading of what is owed; null when there is none. */
  owed: { cents: number; date: Date } | null;
};

export type CardDue = {
  accountId: string;
  name: string;
  date: Date;
  daysAway: number;
  /** What is owed, from the latest reading; null when none is known. */
  owedCents: number | null;
  minimumCents: number | null;
};

/**
 * Cards whose payment falls from today through `days` days ahead. A card known to owe nothing is
 * left out: there is nothing to pay.
 */
export function cardsDueWithin(cards: readonly CardTerms[], todayYmd: string, days: number): CardDue[] {
  const today = dateFromYmd(todayYmd).getTime();
  const out: CardDue[] = [];
  for (const card of cards) {
    if (card.paymentDueDay === null) continue;
    if (card.owed && card.owed.cents <= 0) continue;
    const date = nextDueDate(card.paymentDueDay, todayYmd);
    const daysAway = Math.round((date.getTime() - today) / 86_400_000);
    if (daysAway > days) continue;
    out.push({
      accountId: card.id,
      name: card.name,
      date,
      daysAway,
      owedCents: card.owed?.cents ?? null,
      minimumCents: card.minimumPaymentCents,
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name));
}

/** "the 15th", "the last day" for 31. */
export function dueDayLabel(day: number): string {
  if (day === 31) return "the last day";
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `the ${day}${suffix}`;
}
