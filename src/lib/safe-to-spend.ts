/**
 * Safe to spend: one number for what is free to spend for the rest of the month.
 *
 *   income received this month − spent this month
 *   + income still expected (recurring and planned income due by month end)
 *   − bills still due (recurring and planned expenses due by month end, outside a budgeted category)
 *   − bills in the buffer (expenses due next month, within the user's buffer of days from today)
 *   − what is left in budgets (a budget's unspent remainder is already promised)
 *   − planned savings-goal contributions for the month
 *
 * A bill in a budgeted category is not subtracted on its own: the budget's remainder already
 * holds it, and counting both would take it twice.
 *
 * The buffer only ever adds bills. Bills due by month end always count; a buffer of N days also
 * holds back the bills due in the next N days that fall in the next month (rent on the 1st, seen
 * from the 28th), so this month's money is not spent on them. Those count whatever their category:
 * this month's budget remainder does not hold next month's bill. Income due next month is not
 * added, since it pays for next month.
 */

/** The longest buffer that can be set, in days. */
export const SAFE_TO_SPEND_BUFFER_MAX_DAYS = 60;

export type SafeToSpendRuleOccurrence = {
  type: "INCOME" | "EXPENSE";
  amountCents: number;
  categoryId: string;
  dateYmd: string;
};

export type SafeToSpendBudgetRow = { categoryId: string; limitCents: number; spentCents: number };

export type SafeToSpendInput = {
  todayYmd: string;
  incomeReceivedCents: number;
  spentCents: number;
  /** Unposted recurring occurrences and open plans from the start of the month on (overdue ones included). */
  occurrences: readonly SafeToSpendRuleOccurrence[];
  budgets: readonly SafeToSpendBudgetRow[];
  /** What each dated savings goal needs a month to make its date. */
  goalContributionsCents: readonly number[];
  /**
   * Hold back bills due up to this many days after today, into next month too. Null or absent:
   * bills to month end only. The occurrences must reach that far.
   */
  bufferDays?: number | null;
};

export type SafeToSpend = {
  safeCents: number;
  /** Safe-to-spend spread over the days left in the month, today included; 0 when negative. */
  perDayCents: number;
  daysLeft: number;
  incomeReceivedCents: number;
  spentCents: number;
  expectedIncomeCents: number;
  billsDueCents: number;
  /** The buffer as set, in days; null when it is off. */
  bufferDays: number | null;
  /** The last day of next month's bills the buffer holds back; null when it is off or ends this month. */
  bufferUntilYmd: string | null;
  /** Bills due next month, through `bufferUntilYmd`. */
  bufferBillsCents: number;
  budgetLeftCents: number;
  goalsCents: number;
};

export function daysLeftInMonth(todayYmd: string): number {
  const [y, m, d] = todayYmd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d + 1;
}

/** `ymd` moved `days` days on, as `YYYY-MM-DD`. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 4" for `2026-12-04`: how the buffer's last day is named on the card. */
export function shortDateYmd(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}

/** How many days ahead the forecast must reach for this month's bills and the buffer's. */
export function safeToSpendForecastDays(todayYmd: string, bufferDays: number | null | undefined): number {
  return Math.max(daysLeftInMonth(todayYmd), bufferDays ?? 0);
}

/**
 * A buffer as typed: empty for off, else whole days from 1 to {@link SAFE_TO_SPEND_BUFFER_MAX_DAYS}.
 * Throws with the reason to show.
 */
export function parseSafeToSpendBufferDays(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const days = Number(text);
  if (!Number.isInteger(days) || days < 1 || days > SAFE_TO_SPEND_BUFFER_MAX_DAYS) {
    throw new Error(`Enter a whole number of days from 1 to ${SAFE_TO_SPEND_BUFFER_MAX_DAYS}, or leave it empty for none.`);
  }
  return days;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpend {
  const ym = input.todayYmd.slice(0, 7);
  const monthEnd = `${ym}-31`;
  const bufferDays = input.bufferDays ?? null;
  const bufferEnd = bufferDays !== null ? addDaysYmd(input.todayYmd, bufferDays) : null;
  const bufferUntilYmd = bufferEnd !== null && bufferEnd > monthEnd ? bufferEnd : null;
  const budgeted = new Set(input.budgets.filter((b) => b.limitCents > 0).map((b) => b.categoryId));
  let expectedIncomeCents = 0;
  let billsDueCents = 0;
  let bufferBillsCents = 0;
  for (const o of input.occurrences) {
    if (o.dateYmd.slice(0, 7) === ym) {
      if (o.type === "INCOME") expectedIncomeCents += o.amountCents;
      else if (!budgeted.has(o.categoryId)) billsDueCents += o.amountCents;
    } else if (o.type === "EXPENSE" && bufferUntilYmd !== null && o.dateYmd > monthEnd && o.dateYmd <= bufferUntilYmd) {
      bufferBillsCents += o.amountCents;
    }
  }
  const budgetLeftCents = input.budgets.reduce((sum, b) => sum + Math.max(0, b.limitCents - b.spentCents), 0);
  const goalsCents = input.goalContributionsCents.reduce((sum, c) => sum + Math.max(0, c), 0);
  const safeCents =
    input.incomeReceivedCents -
    input.spentCents +
    expectedIncomeCents -
    billsDueCents -
    bufferBillsCents -
    budgetLeftCents -
    goalsCents;
  const daysLeft = daysLeftInMonth(input.todayYmd);
  return {
    safeCents,
    perDayCents: safeCents > 0 ? Math.floor(safeCents / daysLeft) : 0,
    daysLeft,
    incomeReceivedCents: input.incomeReceivedCents,
    spentCents: input.spentCents,
    expectedIncomeCents,
    billsDueCents,
    bufferDays,
    bufferUntilYmd,
    bufferBillsCents,
    budgetLeftCents,
    goalsCents,
  };
}
