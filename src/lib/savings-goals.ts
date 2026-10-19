import { dateFromYmd } from "@/lib/date-only";

/**
 * Savings goals: a target amount, an optional date, and how far along the user is.
 *
 * A goal linked to an account measures progress by that account's latest balance (the same
 * readings net worth uses: bank balances, hand-entered balances and portfolio snapshots), so
 * the user never has to log contributions twice. Two goals on one account each see its whole
 * balance; the account is the pot, not a share of it. A goal with no account is tracked by
 * hand: the user records what they have put aside.
 *
 * The pace is how fast the linked balance has grown, measured over about the last three
 * months of readings. Without enough readings for that (an account whose balance is entered
 * by hand now and then, say), it falls back to what has been transferred into the account
 * over the same window. With a date, the pace decides whether the goal is on track; with or
 * without one, it gives an estimated completion date.
 */

export const MAX_GOAL_NAME_LENGTH = 80;

const DAY_MS = 24 * 60 * 60 * 1000;
const AVG_MONTH_DAYS = 365.25 / 12;
/** How far back the pace looks, and the least history it needs to say anything. */
const PACE_WINDOW_DAYS = 90;
const PACE_MIN_DAYS = 28;

export type GoalReading = { date: Date; cents: number };

export type SavingsGoalInput = {
  targetCents: number;
  /** Date-only, midnight UTC. */
  targetDate: Date | null;
  accountId: string | null;
  savedCents: number;
};

export type GoalStatus =
  /** Saved at least the target. */
  | "reached"
  /** The date has passed without reaching it. */
  | "overdue"
  /** Growing fast enough to get there by the date. */
  | "on-track"
  /** Growing, but too slowly (or not at all) for the date. */
  | "behind"
  /** Has a date but no pace to judge by yet; shows only what is needed a month. */
  | "needs"
  /** No date: progress only. */
  | "open"
  /** Linked to an account with no balance yet. */
  | "no-balance";

export type GoalProgress = {
  /** Null when the linked account has no balance reading yet. */
  savedCents: number | null;
  remainingCents: number;
  /** 0–1. */
  fraction: number;
  status: GoalStatus;
  /** Months from today to the target date (nearest whole, at least 1); null with no date or once past. */
  monthsLeft: number | null;
  /** What to put aside each month to make the date; null with no date, once reached, or past. */
  monthlyNeededCents: number | null;
  /** Recent growth of the linked balance per month; null without enough history. */
  monthlyPaceCents: number | null;
  /** Recent net transfers into the linked account per month; null without enough history. */
  monthlyTransferCents: number | null;
  /** When the goal is reached at the current pace (`YYYY-MM-DD`); null when it never would be. */
  projectedYmd: string | null;
  /** Which pace `projectedYmd` and the on-track judgement use. */
  paceSource: "balance" | "transfers" | null;
};

function addDaysYmd(ymd: string, days: number): string {
  return new Date(dateFromYmd(ymd).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Monthly growth of a balance from its readings: the latest one against the one closest to
 * {@link PACE_WINDOW_DAYS} before it. Null with less than {@link PACE_MIN_DAYS} between them.
 */
export function monthlyPaceCents(readings: readonly GoalReading[], todayYmd: string): number | null {
  const tomorrow = dateFromYmd(todayYmd).getTime() + DAY_MS;
  const past = readings.filter((r) => r.date.getTime() < tomorrow).sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = past.at(-1);
  if (!latest) return null;
  const windowStart = latest.date.getTime() - PACE_WINDOW_DAYS * DAY_MS;
  // The latest reading on or before the window's start, else the earliest inside it.
  const baseline = past.filter((r) => r.date.getTime() <= windowStart).at(-1) ?? past[0];
  const days = (latest.date.getTime() - baseline.date.getTime()) / DAY_MS;
  if (days < PACE_MIN_DAYS) return null;
  return Math.round(((latest.cents - baseline.cents) / days) * AVG_MONTH_DAYS);
}

/**
 * Monthly net transfers into an account: what arrived less what left over the last
 * {@link PACE_WINDOW_DAYS}, or since the first transfer when that is more recent. Null with
 * fewer than two transfers in the window or less than {@link PACE_MIN_DAYS} of history.
 *
 * `transfers` carries cents moved in (negative for moved out), as `savingsCentsFor` gives them.
 */
export function monthlyTransferPaceCents(transfers: readonly GoalReading[], todayYmd: string): number | null {
  const today = dateFromYmd(todayYmd).getTime();
  const past = transfers.filter((t) => t.date.getTime() <= today && t.cents !== 0);
  if (past.length === 0) return null;
  const first = Math.min(...past.map((t) => t.date.getTime()));
  const start = Math.max(first, today - PACE_WINDOW_DAYS * DAY_MS);
  const days = (today - start) / DAY_MS;
  const inWindow = past.filter((t) => t.date.getTime() >= start);
  if (days < PACE_MIN_DAYS || inWindow.length < 2) return null;
  const net = inWindow.reduce((sum, t) => sum + t.cents, 0);
  return Math.round((net / days) * AVG_MONTH_DAYS);
}

/** The latest reading on or before today. */
export function latestReading(readings: readonly GoalReading[], todayYmd: string): GoalReading | null {
  const tomorrow = dateFromYmd(todayYmd).getTime() + DAY_MS;
  let best: GoalReading | null = null;
  for (const r of readings) {
    if (r.date.getTime() >= tomorrow) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}

/**
 * Months from `fromYmd` to `toYmd` to the nearest whole one, at least 1, so a goal a year and
 * a day out is 12 months, not 13. Null once `toYmd` is past.
 */
export function monthsUntil(fromYmd: string, toYmd: string): number | null {
  const days = (dateFromYmd(toYmd).getTime() - dateFromYmd(fromYmd).getTime()) / DAY_MS;
  if (days < 0) return null;
  return Math.max(1, Math.round(days / AVG_MONTH_DAYS));
}

export function computeGoalProgress(
  goal: SavingsGoalInput,
  readings: readonly GoalReading[],
  todayYmd: string,
  /** Cents transferred into the linked account, by date; see {@link monthlyTransferPaceCents}. */
  transfers: readonly GoalReading[] = [],
): GoalProgress {
  const linked = goal.accountId !== null;
  const saved = linked ? (latestReading(readings, todayYmd)?.cents ?? null) : goal.savedCents;
  const balancePace = linked ? monthlyPaceCents(readings, todayYmd) : null;
  const transferPace = linked ? monthlyTransferPaceCents(transfers, todayYmd) : null;
  // The balance is the truth when there is enough of it; transfers are the fallback.
  const paceSource: GoalProgress["paceSource"] = balancePace !== null ? "balance" : transferPace !== null ? "transfers" : null;
  const pace = balancePace ?? transferPace;
  const target = Math.max(goal.targetCents, 1);
  const have = saved ?? 0;
  const remaining = Math.max(0, goal.targetCents - have);
  const fraction = Math.min(1, Math.max(0, have / target));
  const targetYmd = goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null;
  const monthsLeft = targetYmd ? monthsUntil(todayYmd, targetYmd) : null;
  const projectedYmd =
    pace !== null && pace > 0 && remaining > 0
      ? addDaysYmd(todayYmd, Math.ceil((remaining / pace) * AVG_MONTH_DAYS))
      : null;

  const base = {
    savedCents: saved,
    remainingCents: remaining,
    fraction,
    monthlyPaceCents: balancePace,
    monthlyTransferCents: transferPace,
    projectedYmd,
    paceSource,
  };
  if (saved === null) return { ...base, status: "no-balance", monthsLeft, monthlyNeededCents: null };
  if (remaining === 0) return { ...base, status: "reached", monthsLeft, monthlyNeededCents: null, projectedYmd: null };
  if (!targetYmd) return { ...base, status: "open", monthsLeft: null, monthlyNeededCents: null };
  if (monthsLeft === null) return { ...base, status: "overdue", monthsLeft: null, monthlyNeededCents: null };
  const needed = Math.ceil(remaining / monthsLeft);
  const status: GoalStatus = pace === null ? "needs" : pace >= needed ? "on-track" : "behind";
  return { ...base, status, monthsLeft, monthlyNeededCents: needed };
}
