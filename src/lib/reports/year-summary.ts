import {
  incomeVsSpendingByMonth,
  merchantSummaries,
  withinWindow,
  yearOverYearByCategory,
  type MerchantSummary,
  type MonthFlow,
  type ReportTx,
} from "./index";

/**
 * The year-end page (`/reports/year`): a year in review, totals per tag for the tax return
 * (deductible costs, donations, medical, anything the user tags), and contributions to and
 * withdrawals from registered accounts as recorded on the Investments card. Plain arithmetic
 * over loaded rows, like the rest of Reports; the app gives no tax advice and files nothing.
 */

/** Tag names that usually matter at tax time, listed first and marked on the page. */
const TAX_TAG_PATTERN = /tax|deduct|donat|charit|medical|health|business|work|moving|child ?care|tuition/i;

export function looksTaxRelated(tagName: string): boolean {
  return TAX_TAG_PATTERN.test(tagName);
}

export type YearTagTotal = {
  tagId: string;
  name: string;
  taxRelated: boolean;
  count: number;
  spentCents: number;
  receivedCents: number;
};

export type RegisteredAccountYear = {
  accountId: string;
  accountName: string;
  accountType: string;
  contributedCents: number;
  withdrawnCents: number;
};

export type YearSummary = {
  year: number;
  /** True while the year is still running: totals are to today. */
  toDate: boolean;
  incomeCents: number;
  spendingCents: number;
  /** Income less spending. */
  netCents: number;
  /** Last year's spending over the same dates, for the comparison line; 0 when there was none. */
  previousSpendingCents: number;
  transactionCount: number;
  months: MonthFlow[];
  /** The month with the most spending, or null in a year with none. */
  biggestMonth: MonthFlow | null;
  topCategories: Array<{ categoryName: string; cents: number; changeRatio: number | null }>;
  topPayees: MerchantSummary[];
  tags: YearTagTotal[];
  registered: RegisteredAccountYear[];
};

/** January 1 through the end of the year, or through today for the year now running. */
export function yearWindow(year: number, todayYmd: string): { start: Date; end: Date; toDate: boolean } {
  const start = new Date(Date.UTC(year, 0, 1));
  const running = String(year) === todayYmd.slice(0, 4);
  if (!running) return { start, end: new Date(Date.UTC(year + 1, 0, 1)), toDate: false };
  const end = new Date(`${todayYmd}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, toDate: true };
}

export function buildYearSummary(input: {
  year: number;
  todayYmd: string;
  /** This year's rows and last year's, for the comparison. */
  txs: readonly ReportTx[];
  tags: ReadonlyArray<{ id: string; name: string }>;
  flows: ReadonlyArray<{
    accountId: string;
    accountName: string;
    accountType: string;
    date: Date;
    direction: "CONTRIBUTION" | "WITHDRAWAL";
    amountCents: number;
  }>;
}): YearSummary {
  const window = yearWindow(input.year, input.todayYmd);
  const rows = withinWindow(input.txs, window);
  const income = rows.filter((tx) => tx.type === "INCOME").reduce((sum, tx) => sum + tx.amountCents, 0);
  const spending = rows.filter((tx) => tx.type === "EXPENSE").reduce((sum, tx) => sum + tx.amountCents, 0);
  const lastMonth = window.toDate ? input.todayYmd.slice(5, 7) : "12";
  const monthKeys = Array.from({ length: Number(lastMonth) }, (_, i) => `${input.year}-${String(i + 1).padStart(2, "0")}`);
  const months = incomeVsSpendingByMonth(rows, monthKeys);
  const biggestMonth = months.reduce<MonthFlow | null>(
    (best, m) => (m.spendingCents > 0 && (!best || m.spendingCents > best.spendingCents) ? m : best),
    null,
  );
  const yoy = yearOverYearByCategory(input.txs, window);

  const tagTotals = new Map<string, YearTagTotal>();
  const tagName = new Map(input.tags.map((t) => [t.id, t.name]));
  for (const tx of rows) {
    for (const tagId of tx.tagIds ?? []) {
      const name = tagName.get(tagId);
      if (!name) continue;
      const total =
        tagTotals.get(tagId) ??
        { tagId, name, taxRelated: looksTaxRelated(name), count: 0, spentCents: 0, receivedCents: 0 };
      total.count += 1;
      if (tx.type === "EXPENSE") total.spentCents += tx.amountCents;
      else if (tx.type === "INCOME") total.receivedCents += tx.amountCents;
      tagTotals.set(tagId, total);
    }
  }

  const registered = new Map<string, RegisteredAccountYear>();
  for (const flow of input.flows) {
    if (flow.date < window.start || flow.date >= window.end) continue;
    const entry =
      registered.get(flow.accountId) ??
      { accountId: flow.accountId, accountName: flow.accountName, accountType: flow.accountType, contributedCents: 0, withdrawnCents: 0 };
    if (flow.direction === "CONTRIBUTION") entry.contributedCents += flow.amountCents;
    else entry.withdrawnCents += flow.amountCents;
    registered.set(flow.accountId, entry);
  }

  return {
    year: input.year,
    toDate: window.toDate,
    incomeCents: income,
    spendingCents: spending,
    netCents: income - spending,
    previousSpendingCents: yoy.previousTotalCents,
    transactionCount: rows.length,
    months,
    biggestMonth,
    topCategories: yoy.rows
      .filter((r) => r.currentCents > 0)
      .slice(0, 5)
      .map((r) => ({ categoryName: r.categoryName, cents: r.currentCents, changeRatio: r.changeRatio })),
    topPayees: merchantSummaries(rows)
      .filter((m) => m.spentCents > 0)
      .slice(0, 5),
    // Tax-looking tags first, then by size.
    tags: [...tagTotals.values()].sort(
      (a, b) =>
        Number(b.taxRelated) - Number(a.taxRelated) ||
        b.spentCents + b.receivedCents - (a.spentCents + a.receivedCents) ||
        a.name.localeCompare(b.name),
    ),
    registered: [...registered.values()].sort((a, b) => a.accountName.localeCompare(b.accountName)),
  };
}
