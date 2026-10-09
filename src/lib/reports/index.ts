import { endExclusiveOfMonthYm, formatYmShortLabel, shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { dateFromYmd } from "@/lib/date-only";
import { merchantKeyFor, merchantLabelFor, mostCommon, ymOf } from "@/lib/insights/util";
import type { InsightTx } from "@/lib/insights/types";

/**
 * The Reports page's arithmetic. Plain functions over the same transaction shape the insight
 * engine uses, so each view is testable without a database.
 *
 * Only `EXPENSE` and `INCOME` rows are ever totalled. Transfers are money moving between the
 * user's own accounts; counting them would book a card payment as spending a second time. The
 * loader leaves them out already, and every function here checks the type again by name so a
 * caller that forgets cannot reintroduce them.
 *
 * A negative expense is a refund: it reduces spending in its own category rather than
 * counting as income.
 */
export type ReportTx = InsightTx & {
  /** Ids of the tags on the row; absent when the caller did not load them. */
  tagIds?: string[];
};

/** The dashboard's `?tag=` filter applied to report rows; everything when no tag is chosen. */
export function filterByTag<T extends ReportTx>(txs: readonly T[], tagId: string | null): T[] {
  if (!tagId) return [...txs];
  return txs.filter((tx) => tx.tagIds?.includes(tagId));
}

/** `12m` is the trailing twelve months; a four-digit year is that calendar year. */
export type ReportPeriodKey = "12m" | `${number}`;

export type ReportPeriod = {
  key: ReportPeriodKey;
  label: string;
  /** Every month in the period, oldest first, as `YYYY-MM`. */
  months: string[];
  /** First day included. */
  start: Date;
  /** First day not included: tomorrow for a period that runs to today. */
  end: Date;
  /** True when the period stops at today rather than at the end of its last month. */
  toDate: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function monthsBetween(firstYm: string, lastYm: string): string[] {
  const out: string[] = [];
  for (let ym = firstYm; ym <= lastYm; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

/**
 * Resolves the `period` search param. Anything unrecognised, or a year in the future, falls
 * back to the trailing twelve months. A year that is still running stops at today, so its
 * comparison with last year is like for like.
 */
export function resolveReportPeriod(raw: string | undefined, todayYmd: string): ReportPeriod {
  const todayYm = todayYmd.slice(0, 7);
  const tomorrow = new Date(dateFromYmd(todayYmd).getTime() + DAY_MS);
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const thisYear = Number(todayYm.slice(0, 4));

  if (year !== null && year <= thisYear && year >= 1970) {
    const running = year === thisYear;
    const lastYm = running ? todayYm : `${year}-12`;
    return {
      key: String(year) as ReportPeriodKey,
      label: running ? `${year} to date` : String(year),
      months: monthsBetween(`${year}-01`, lastYm),
      start: startOfMonthYm(`${year}-01`),
      end: running ? tomorrow : endExclusiveOfMonthYm(lastYm),
      toDate: running,
    };
  }

  const firstYm = shiftYm(todayYm, -11);
  return {
    key: "12m",
    label: "Last 12 months",
    months: monthsBetween(firstYm, todayYm),
    start: startOfMonthYm(firstYm),
    end: tomorrow,
    toDate: true,
  };
}

/** The same window one year earlier, for year-over-year comparison. */
export function previousYearWindow(period: Pick<ReportPeriod, "start" | "end">): { start: Date; end: Date } {
  const back = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  return { start: back(period.start), end: back(period.end) };
}

function inWindow(tx: ReportTx, window: { start: Date; end: Date }): boolean {
  const t = tx.date.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** The rows dated inside `window`. */
export function withinWindow<T extends ReportTx>(txs: readonly T[], window: { start: Date; end: Date }): T[] {
  return txs.filter((tx) => inWindow(tx, window));
}

function isExpense(tx: ReportTx): boolean {
  return tx.type === "EXPENSE";
}

function isIncome(tx: ReportTx): boolean {
  return tx.type === "INCOME";
}

/** Spend per category for one expense, with split parts taking over from the parent's category. */
function expenseParts(tx: ReportTx): Array<{ categoryId: string; categoryName: string; amountCents: number }> {
  if (tx.splits.length > 0) return tx.splits;
  return [{ categoryId: tx.categoryId, categoryName: tx.categoryName, amountCents: tx.amountCents }];
}

export type MonthFlow = {
  ym: string;
  label: string;
  incomeCents: number;
  spendingCents: number;
  /** Income less spending: positive left over, negative overspent. */
  netCents: number;
  /**
   * Moved into savings accounts by transfer, less moved out (`savings-transfers.ts`); null when
   * no account counts as savings, and saved is then `netCents`.
   */
  toSavingsCents: number | null;
};

/**
 * Income and spending for each month of the period, including months with neither.
 * `toSavingsByMonth` is what `savedByTransferByMonth` gave, when any account counts as savings.
 */
export function incomeVsSpendingByMonth(
  txs: readonly ReportTx[],
  months: readonly string[],
  toSavingsByMonth: ReadonlyMap<string, number> | null = null,
): MonthFlow[] {
  const byMonth = new Map(months.map((ym) => [ym, { income: 0, spending: 0 }]));
  for (const tx of txs) {
    const bucket = byMonth.get(ymOf(tx.date));
    if (!bucket) continue;
    if (isIncome(tx)) bucket.income += tx.amountCents;
    else if (isExpense(tx)) bucket.spending += tx.amountCents;
  }
  const crossesYears = new Set(months.map((ym) => ym.slice(0, 4))).size > 1;
  return months.map((ym) => {
    const { income, spending } = byMonth.get(ym)!;
    return {
      ym,
      label: formatYmShortLabel(ym, crossesYears),
      incomeCents: income,
      spendingCents: spending,
      netCents: income - spending,
      toSavingsCents: toSavingsByMonth ? (toSavingsByMonth.get(ym) ?? 0) : null,
    };
  });
}

export type CashFlowNode = {
  name: string;
  kind: "income" | "refunds" | "shortfall" | "hub" | "expense" | "savings" | "saved";
  cents: number;
};

export type CashFlowLink = { source: number; target: number; value: number };

export type CashFlow = {
  incomeCents: number;
  spendingCents: number;
  nodes: CashFlowNode[];
  links: CashFlowLink[];
};

const HUB_NAME = "Income";

/**
 * A cash-flow Sankey: income by category flows into one hub, and out of it to spending by
 * category and whatever was left over.
 *
 * The hub always balances. A month where spending beat income gets a "From savings" source
 * covering the gap instead of a "Saved" sink. A category that came out negative — refunds
 * outweighing purchases — cannot be drawn as a negative band, so it joins the inflows as
 * "Refunds" rather than silently vanishing from the total.
 *
 * Spending beyond `maxExpenseNodes - 1` categories is folded into one "Everything else" band:
 * a Sankey with thirty thin ribbons is unreadable on a phone.
 *
 * When accounts count as savings, `toSavingsCents` (net moved into them by transfer) gets its
 * own "To savings" band, or a "From savings accounts" source when more came out than went in,
 * and the leftover is what stayed in the other accounts.
 */
export function cashFlow(
  txs: readonly ReportTx[],
  options: { maxExpenseNodes?: number; toSavingsCents?: number | null } = {},
): CashFlow {
  const toSavings = options.toSavingsCents ?? null;
  const maxExpenseNodes = Math.max(2, options.maxExpenseNodes ?? 8);
  const incomeByCat = new Map<string, number>();
  const spendByCat = new Map<string, number>();
  for (const tx of txs) {
    if (isIncome(tx)) {
      incomeByCat.set(tx.categoryName, (incomeByCat.get(tx.categoryName) ?? 0) + tx.amountCents);
    } else if (isExpense(tx)) {
      for (const part of expenseParts(tx)) {
        spendByCat.set(part.categoryName, (spendByCat.get(part.categoryName) ?? 0) + part.amountCents);
      }
    }
  }

  const incomeCents = [...incomeByCat.values()].reduce((a, b) => a + b, 0);
  const spendingCents = [...spendByCat.values()].reduce((a, b) => a + b, 0);

  const byAmount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
  const incomeIn = [...incomeByCat].filter(([, c]) => c > 0).sort(byAmount);
  // Income categories that net negative (a clawback, say) reduce what is available.
  const incomeOut = [...incomeByCat].filter(([, c]) => c < 0).reduce((sum, [, c]) => sum - c, 0);
  const spendOut = [...spendByCat].filter(([, c]) => c > 0).sort(byAmount);
  const refunds = [...spendByCat].filter(([, c]) => c < 0).reduce((sum, [, c]) => sum - c, 0);

  let expenses = spendOut;
  if (spendOut.length > maxExpenseNodes) {
    const kept = spendOut.slice(0, maxExpenseNodes - 1);
    const rest = spendOut.slice(maxExpenseNodes - 1).reduce((sum, [, c]) => sum + c, 0);
    expenses = [...kept, ["Everything else", rest]];
  }

  const grossIn = incomeIn.reduce((s, [, c]) => s + c, 0) + refunds;
  const grossOut = expenses.reduce((s, [, c]) => s + c, 0) + incomeOut;
  const moved = toSavings ?? 0;
  const leftover = grossIn - grossOut - moved;

  const nodes: CashFlowNode[] = [];
  const links: CashFlowLink[] = [];
  if (grossIn === 0 && grossOut === 0 && moved === 0) return { incomeCents, spendingCents, nodes, links };

  const tracked = toSavings !== null;
  const sources: CashFlowNode[] = [
    ...incomeIn.map(([name, cents]) => ({ name, kind: "income" as const, cents })),
    ...(refunds > 0 ? [{ name: "Refunds", kind: "refunds" as const, cents: refunds }] : []),
    ...(moved < 0 ? [{ name: "From savings accounts", kind: "shortfall" as const, cents: -moved }] : []),
    ...(leftover < 0
      ? [{ name: tracked ? "From account balances" : "From savings", kind: "shortfall" as const, cents: -leftover }]
      : []),
  ];
  const sinks: CashFlowNode[] = [
    ...expenses.map(([name, cents]) => ({ name, kind: "expense" as const, cents })),
    ...(incomeOut > 0 ? [{ name: "Income reversed", kind: "expense" as const, cents: incomeOut }] : []),
    ...(moved > 0 ? [{ name: "To savings", kind: "savings" as const, cents: moved }] : []),
    ...(leftover > 0 ? [{ name: tracked ? "Left in accounts" : "Saved", kind: "saved" as const, cents: leftover }] : []),
  ];

  nodes.push(...sources);
  const hub = nodes.length;
  nodes.push({ name: HUB_NAME, kind: "hub", cents: sources.reduce((sum, n) => sum + n.cents, 0) });
  for (let i = 0; i < sources.length; i++) links.push({ source: i, target: hub, value: sources[i].cents });
  for (const sink of sinks) {
    links.push({ source: hub, target: nodes.length, value: sink.cents });
    nodes.push(sink);
  }
  return { incomeCents, spendingCents, nodes, links };
}

export type CategoryYearRow = {
  categoryId: string;
  categoryName: string;
  currentCents: number;
  previousCents: number;
  changeCents: number;
  /** Fractional change; null when last year had nothing to compare against. */
  changeRatio: number | null;
};

export type YearOverYear = {
  rows: CategoryYearRow[];
  currentTotalCents: number;
  previousTotalCents: number;
};

/**
 * Spending by category in the period against the same dates a year earlier. Rows are
 * ordered by this period's spend, then by last year's, so categories that stopped entirely
 * sink to the bottom rather than vanishing — a stopped expense is the comparison's point.
 */
export function yearOverYearByCategory(
  txs: readonly ReportTx[],
  period: Pick<ReportPeriod, "start" | "end">,
): YearOverYear {
  const previous = previousYearWindow(period);
  const rows = new Map<string, CategoryYearRow>();
  for (const tx of txs) {
    if (!isExpense(tx)) continue;
    const current = inWindow(tx, period);
    if (!current && !inWindow(tx, previous)) continue;
    for (const part of expenseParts(tx)) {
      let row = rows.get(part.categoryId);
      if (!row) {
        row = {
          categoryId: part.categoryId,
          categoryName: part.categoryName,
          currentCents: 0,
          previousCents: 0,
          changeCents: 0,
          changeRatio: null,
        };
        rows.set(part.categoryId, row);
      }
      if (current) row.currentCents += part.amountCents;
      else row.previousCents += part.amountCents;
    }
  }
  const list = [...rows.values()]
    .filter((r) => r.currentCents !== 0 || r.previousCents !== 0)
    .map((r) => ({
      ...r,
      changeCents: r.currentCents - r.previousCents,
      changeRatio: r.previousCents > 0 ? (r.currentCents - r.previousCents) / r.previousCents : null,
    }))
    .sort(
      (a, b) =>
        b.currentCents - a.currentCents ||
        b.previousCents - a.previousCents ||
        a.categoryName.localeCompare(b.categoryName),
    );
  return {
    rows: list,
    currentTotalCents: list.reduce((s, r) => s + r.currentCents, 0),
    previousTotalCents: list.reduce((s, r) => s + r.previousCents, 0),
  };
}

export type MerchantSummary = {
  key: string;
  label: string;
  count: number;
  spentCents: number;
  receivedCents: number;
  lastDate: Date;
};

/**
 * Every payee in `txs`, biggest spend first. Rows are grouped the way the insight engine
 * groups them, so "SQ *BLUE BOTTLE #412" and a hand-typed "Blue Bottle" are one payee.
 * Rows with no usable title or merchant are left out: there is nothing to call them.
 */
export function merchantSummaries(txs: readonly ReportTx[]): MerchantSummary[] {
  const groups = new Map<string, ReportTx[]>();
  for (const tx of txs) {
    if (!isExpense(tx) && !isIncome(tx)) continue;
    const key = merchantKeyFor(tx);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  return [...groups].map(([key, rows]) => summarise(key, rows)).sort(
    (a, b) => b.spentCents - a.spentCents || b.receivedCents - a.receivedCents || a.label.localeCompare(b.label),
  );
}

function summarise(key: string, rows: readonly ReportTx[]): MerchantSummary {
  let spent = 0;
  let received = 0;
  let last = rows[0].date;
  for (const tx of rows) {
    if (isExpense(tx)) spent += tx.amountCents;
    else received += tx.amountCents;
    if (tx.date > last) last = tx.date;
  }
  return {
    key,
    label: mostCommon(rows.map((tx) => merchantLabelFor(tx))) ?? key,
    count: rows.length,
    spentCents: spent,
    receivedCents: received,
    lastDate: last,
  };
}

export type MerchantMonth = { ym: string; label: string; spentCents: number; receivedCents: number };

export type MerchantActivity = MerchantSummary & {
  firstDate: Date;
  /** Newest first. */
  transactions: ReportTx[];
  /** Every month from the first transaction to the last, quiet months included. */
  months: MerchantMonth[];
  categories: Array<{ categoryName: string; spentCents: number }>;
};

/** Everything from one payee, by the key `merchantSummaries` gave it; null when nothing matches. */
export function merchantActivity(txs: readonly ReportTx[], key: string): MerchantActivity | null {
  const rows = txs.filter((tx) => (isExpense(tx) || isIncome(tx)) && merchantKeyFor(tx) === key);
  if (rows.length === 0) return null;
  const summary = summarise(key, rows);
  const sorted = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime() || b.amountCents - a.amountCents);
  const firstDate = sorted[sorted.length - 1].date;

  const span = monthsBetween(ymOf(firstDate), ymOf(summary.lastDate));
  const crossesYears = new Set(span.map((ym) => ym.slice(0, 4))).size > 1;
  const byMonth = new Map(span.map((ym) => [ym, { spent: 0, received: 0 }]));
  const byCategory = new Map<string, number>();
  for (const tx of rows) {
    const bucket = byMonth.get(ymOf(tx.date))!;
    if (isExpense(tx)) {
      bucket.spent += tx.amountCents;
      for (const part of expenseParts(tx)) {
        byCategory.set(part.categoryName, (byCategory.get(part.categoryName) ?? 0) + part.amountCents);
      }
    } else {
      bucket.received += tx.amountCents;
    }
  }

  return {
    ...summary,
    firstDate,
    transactions: sorted,
    months: span.map((ym) => ({
      ym,
      label: formatYmShortLabel(ym, crossesYears),
      spentCents: byMonth.get(ym)!.spent,
      receivedCents: byMonth.get(ym)!.received,
    })),
    categories: [...byCategory]
      .map(([categoryName, spentCents]) => ({ categoryName, spentCents }))
      .sort((a, b) => b.spentCents - a.spentCents),
  };
}

/** Years that have any transactions, newest first, for the period picker. */
export function yearsWithActivity(dates: readonly Date[], todayYmd: string): string[] {
  const years = new Set(dates.map((d) => String(d.getUTCFullYear())));
  years.add(todayYmd.slice(0, 4));
  return [...years].filter((y) => y <= todayYmd.slice(0, 4)).sort().reverse();
}
