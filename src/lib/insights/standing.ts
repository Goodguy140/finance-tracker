import {
  computeRoomYear,
  FHSA_CARRY_FORWARD_MAX_CENTS,
  RRSP_FIRST_DAYS_OF_NEXT_YEAR,
  type RoomEntry,
  type RoomFlow,
} from "@/lib/contribution-room";
import type { FinancialScore } from "@/lib/financial-score";
import type { GoalProgress } from "@/lib/savings-goals";
import { categoryAmounts } from "./facts";
import type { Insight, InsightTx } from "./types";
import {
  DAY_MS,
  historyStartOf,
  MIN_OBSERVED_MONTHS,
  observedMonths,
  previousFullMonths,
  wholeDaysSince,
  ymOf,
  type MoneyFormatter,
} from "./util";

/**
 * Where things stand outside the transaction log: money owed back, registered-account room
 * about to lapse, cash beyond a sensible cushion, savings goals behind, and what is going
 * well. All of it is about the user's whole picture, so none of it is worked out under a tag.
 */
export type StandingInput = {
  txs: InsightTx[];
  now: Date;
  fmt: MoneyFormatter;
  /** Outstanding shares, oldest first. */
  owed: Array<{ name: string; amountCents: number; date: Date; title: string | null }> | null;
  /** Canadian registered accounts' room; null outside Canada or with no such account. */
  room: { entries: RoomEntry[]; flows: RoomFlow[]; types: Array<"TFSA" | "RRSP" | "FHSA"> } | null;
  score: FinancialScore | null;
  goals: Array<{ id: string; name: string; targetCents: number; targetYmd: string | null; progress: GoalProgress }> | null;
};

export function detectStanding(input: StandingInput): Insight[] {
  return [
    ...owedToYou(input),
    ...roomDeadlines(input),
    ...idleCash(input),
    ...goalsBehind(input),
    ...goodNews(input),
  ];
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// --- Money owed to you -----------------------------------------------------------------------

/** A share outstanding this long is worth a reminder; a dinner split last week is not. */
export const OWED_REMIND_DAYS = 30;

function owedToYou({ owed, now, fmt }: StandingInput): Insight[] {
  if (!owed?.length) return [];
  const oldest = owed[0];
  const days = wholeDaysSince(oldest.date, now);
  if (days < OWED_REMIND_DAYS) return [];
  const total = owed.reduce((s, o) => s + o.amountCents, 0);
  const people = new Set(owed.map((o) => o.name.trim().toLowerCase())).size;
  const who = people === 1 ? `${oldest.name} owes you` : `${people} people owe you`;
  return [
    {
      // Keyed by the oldest share: once it is paid back, a later reminder is a new one.
      key: `owed:${oldest.date.toISOString().slice(0, 10)}:${oldest.name.trim().toLowerCase()}`,
      section: "improvement",
      severity: days >= OWED_REMIND_DAYS * 2 ? "medium" : "low",
      title: `${who} ${fmt(total)}`,
      body:
        `The oldest, ${people === 1 ? "" : `${oldest.name}'s `}${fmt(oldest.amountCents)}` +
        `${oldest.title ? ` for ${oldest.title}` : ""}, is from ${shortDate.format(oldest.date)}, ${days} days ago. ` +
        `A reminder now is easier than one later.`,
      evidenceTxIds: [],
      action: { kind: "link", href: "/", label: "See who owes you" },
    },
  ];
}

// --- Registered account deadlines ------------------------------------------------------------

/** How long before the FHSA year closes to mention room that would be lost. */
const FHSA_NOTICE_FROM_MONTH = 10; // November, 0-based
const MIN_ROOM_CENTS = 10_000;

function roomDeadlines({ room, now, fmt }: StandingInput): Insight[] {
  if (!room) return [];
  const out: Insight[] = [];
  const year = now.getUTCFullYear();
  const dayOfYear = Math.floor((now.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;

  // RRSP: the first 60 days of a year still count toward the year before.
  if (room.types.includes("RRSP") && dayOfYear <= RRSP_FIRST_DAYS_OF_NEXT_YEAR) {
    const last = computeRoomYear("RRSP", year - 1, room.entries, room.flows);
    if (last.remainingCents !== null && last.remainingCents >= MIN_ROOM_CENTS) {
      const deadline = new Date(Date.UTC(year, 0, RRSP_FIRST_DAYS_OF_NEXT_YEAR));
      const days = RRSP_FIRST_DAYS_OF_NEXT_YEAR - dayOfYear;
      out.push({
        key: `room:rrsp:${year - 1}`,
        section: "ahead",
        severity: days <= 14 ? "medium" : "low",
        title: `${fmt(last.remainingCents)} of RRSP room left for ${year - 1}`,
        body:
          `Contributions until ${longDate.format(deadline)} can still be deducted on your ${year - 1} return. ` +
          `Unused room carries forward, so this is about the deduction, not losing it.`,
        evidenceTxIds: [],
        action: { kind: "link", href: "/settings/accounts", label: "See contribution room" },
      });
    }
  }

  // FHSA: at most $8,000 of unused room carries into next year; the rest is gone.
  if (room.types.includes("FHSA") && now.getUTCMonth() >= FHSA_NOTICE_FROM_MONTH) {
    const current = computeRoomYear("FHSA", year, room.entries, room.flows);
    const lapsing = current.remainingCents === null ? 0 : current.remainingCents - FHSA_CARRY_FORWARD_MAX_CENTS;
    if (lapsing >= MIN_ROOM_CENTS) {
      out.push({
        key: `room:fhsa:${year}`,
        section: "ahead",
        severity: "medium",
        title: `${fmt(lapsing)} of FHSA room ends on December 31`,
        body:
          `You have ${fmt(current.remainingCents as number)} of room this year, and only ` +
          `${fmt(FHSA_CARRY_FORWARD_MAX_CENTS)} of it carries into ${year + 1}.`,
        evidenceTxIds: [],
        action: { kind: "link", href: "/settings/accounts", label: "See contribution room" },
      });
    }
  }
  return out;
}

// --- Cash beyond the emergency fund ----------------------------------------------------------

/** Months of spending past which cash in chequing and savings is more than a cushion. */
export const IDLE_CASH_MONTHS = 6;
const IDLE_CASH_MIN_CENTS = 500_000;

function idleCash({ score, fmt }: StandingInput): Insight[] {
  if (score?.status !== "scored" || !score.cushion) return [];
  const { fundCents, monthlySpendingCents } = score.cushion;
  if (monthlySpendingCents <= 0) return [];
  const extra = fundCents - monthlySpendingCents * IDLE_CASH_MONTHS;
  if (extra < IDLE_CASH_MIN_CENTS) return [];
  const months = fundCents / monthlySpendingCents;
  return [
    {
      key: `cash:idle:${score.months[score.months.length - 1]}`,
      section: "saving",
      severity: "low",
      title: `About ${fmt(extra)} more cash than a ${IDLE_CASH_MONTHS}-month cushion`,
      body:
        `Chequing and savings hold ${months.toFixed(1)} months of spending. If the part beyond ` +
        `${IDLE_CASH_MONTHS} months is not earning interest, a high-interest account, a TFSA or a goal could put it to work.`,
      evidenceTxIds: [],
    },
  ];
}

// --- Savings goals behind --------------------------------------------------------------------

function goalsBehind({ goals, now, fmt }: StandingInput): Insight[] {
  if (!goals) return [];
  const ym = ymOf(now);
  return goals.flatMap((goal): Insight[] => {
    const { status, monthlyNeededCents, monthlyPaceCents, remainingCents } = goal.progress;
    if (status !== "behind" || monthlyNeededCents === null || !goal.targetYmd) return [];
    const by = longDate.format(new Date(`${goal.targetYmd}T00:00:00.000Z`));
    return [
      {
        key: `goal:behind:${goal.id}:${ym}`,
        section: "improvement",
        severity: "medium",
        title: `${goal.name} is behind`,
        body:
          `${fmt(remainingCents)} to go by ${by} takes about ${fmt(monthlyNeededCents)} a month` +
          `${monthlyPaceCents !== null && monthlyPaceCents > 0 ? `; lately it has grown about ${fmt(monthlyPaceCents)} a month` : "; lately it has not grown"}. ` +
          `Putting more aside, or moving the date, would bring it back on track.`,
        monthlyCents: monthlyNeededCents,
        evidenceTxIds: [],
      },
    ];
  });
}

// --- Good news -------------------------------------------------------------------------------

const FALL_MIN_PCT = 0.3;
const FALL_MIN_CENTS = 5_000;

/**
 * Not everything is a problem. A category well down on its usual, and from the score, every
 * month ending with money left over or every budget kept.
 */
function goodNews({ txs, now, fmt, score }: StandingInput): Insight[] {
  const out: Insight[] = [];
  const monthList = previousFullMonths(now, 4);
  const latest = monthList[3];
  const prior = observedMonths(monthList.slice(0, 3), historyStartOf(txs));
  if (prior.length >= MIN_OBSERVED_MONTHS) {
    const byMonth = new Map<string, { name: string; months: Map<string, number> }>();
    for (const tx of txs) {
      if (tx.type !== "EXPENSE") continue;
      const ym = ymOf(tx.date);
      if (ym !== latest && !prior.includes(ym)) continue;
      for (const part of categoryAmounts(tx)) {
        const entry = byMonth.get(part.categoryId) ?? { name: part.categoryName, months: new Map<string, number>() };
        entry.months.set(ym, (entry.months.get(ym) ?? 0) + part.amountCents);
        byMonth.set(part.categoryId, entry);
      }
    }
    const falls = [...byMonth.entries()].flatMap(([categoryId, entry]) => {
      const avg = prior.reduce((s, ym) => s + (entry.months.get(ym) ?? 0), 0) / prior.length;
      // Spent in every month before: a one-off that did not repeat is not a habit broken.
      if (prior.some((ym) => (entry.months.get(ym) ?? 0) <= 0)) return [];
      const current = entry.months.get(latest) ?? 0;
      const fall = avg - current;
      return fall >= FALL_MIN_CENTS && fall >= avg * FALL_MIN_PCT ? [{ categoryId, name: entry.name, avg, current, fall }] : [];
    });
    const best = falls.sort((a, b) => b.fall - a.fall)[0];
    if (best) {
      out.push({
        key: `good:down:${best.categoryId}:${latest}`,
        section: "good",
        severity: "low",
        title: `${best.name} was down ${Math.round((best.fall / best.avg) * 100)}% last month`,
        body: `${fmt(best.current)}, against a ${fmt(Math.round(best.avg))} average over the ${prior.length} months before.`,
        evidenceTxIds: [],
      });
    }
  }
  if (score?.status === "scored") {
    const month = score.months[score.months.length - 1];
    const factor = (id: string) => score.factors.find((f) => f.id === id);
    const black = factor("consistency");
    if (black && black.score === 100 && score.months.length >= 3) {
      out.push({
        key: `good:black:${month}`,
        section: "good",
        severity: "low",
        title: `${score.months.length} months in a row with money left over`,
        body: "Every month the score looks at ended with more coming in than going out.",
        evidenceTxIds: [],
      });
    }
    const budgets = factor("budgets");
    if (budgets && budgets.score === 100) {
      out.push({
        key: `good:budgets:${month}`,
        section: "good",
        severity: "low",
        title: "Every budget kept",
        body: `${budgets.detail}.`,
        evidenceTxIds: [],
      });
    }
  }
  return out;
}
