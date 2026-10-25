import { shiftYm } from "@/lib/dashboard-period";
import { ymdFromDateUtc } from "@/lib/date-only";
import { categoryAmounts } from "@/lib/insights/facts";
import type { ReportTx } from "./index";

/**
 * The monthly review (`/reports/month`): what one month came to next to the month before it,
 * which budgets held, and what still wants a look before the month is marked closed. Plain
 * arithmetic over loaded rows, like the rest of Reports.
 */

export type RecapBudget = { categoryName: string; spentCents: number; limitCents: number; carryCents: number };

export type MonthRecap = {
  ym: string;
  incomeCents: number;
  spendingCents: number;
  netCents: number;
  previousIncomeCents: number;
  previousSpendingCents: number;
  transactionCount: number;
  /** Biggest categories this month, with what they were the month before. */
  categories: Array<{ categoryName: string; cents: number; previousCents: number }>;
  /** Categories that moved most against last month, either way; at least $20 and 20%. */
  changes: Array<{ categoryName: string; cents: number; previousCents: number }>;
  biggest: Array<{ dateYmd: string; title: string; cents: number }>;
  budgetsKept: RecapBudget[];
  budgetsMissed: RecapBudget[];
};

const MIN_CHANGE_CENTS = 2_000;
const MIN_CHANGE_RATIO = 0.2;

function byCategory(rows: readonly ReportTx[]): Map<string, { name: string; cents: number }> {
  const out = new Map<string, { name: string; cents: number }>();
  for (const tx of rows) {
    if (tx.type !== "EXPENSE") continue;
    for (const part of categoryAmounts(tx)) {
      const entry = out.get(part.categoryId) ?? { name: part.categoryName, cents: 0 };
      entry.cents += part.amountCents;
      out.set(part.categoryId, entry);
    }
  }
  return out;
}

export function buildMonthRecap(input: {
  ym: string;
  /** Rows from at least the month before through the month itself; others are ignored. */
  txs: readonly ReportTx[];
  budgets: readonly RecapBudget[];
}): MonthRecap {
  const prevYm = shiftYm(input.ym, -1);
  const ymOf = (tx: ReportTx) => ymdFromDateUtc(tx.date).slice(0, 7);
  const rows = input.txs.filter((tx) => ymOf(tx) === input.ym && (tx.type === "EXPENSE" || tx.type === "INCOME"));
  const prev = input.txs.filter((tx) => ymOf(tx) === prevYm && (tx.type === "EXPENSE" || tx.type === "INCOME"));
  const sum = (list: readonly ReportTx[], type: "EXPENSE" | "INCOME") =>
    list.filter((tx) => tx.type === type).reduce((s, tx) => s + tx.amountCents, 0);

  const now = byCategory(rows);
  const before = byCategory(prev);
  const ids = new Set([...now.keys(), ...before.keys()]);
  const all = [...ids].map((id) => ({
    categoryName: now.get(id)?.name ?? before.get(id)?.name ?? "Unknown",
    cents: now.get(id)?.cents ?? 0,
    previousCents: before.get(id)?.cents ?? 0,
  }));

  const income = sum(rows, "INCOME");
  const spending = sum(rows, "EXPENSE");
  const kept = input.budgets.filter((b) => b.limitCents > 0 && b.spentCents <= b.limitCents);
  const missed = input.budgets.filter((b) => b.spentCents > b.limitCents);
  return {
    ym: input.ym,
    incomeCents: income,
    spendingCents: spending,
    netCents: income - spending,
    previousIncomeCents: sum(prev, "INCOME"),
    previousSpendingCents: sum(prev, "EXPENSE"),
    transactionCount: rows.length,
    categories: all
      .filter((c) => c.cents > 0)
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 6),
    changes: all
      .filter((c) => {
        const delta = Math.abs(c.cents - c.previousCents);
        const base = Math.max(c.previousCents, 1);
        return delta >= MIN_CHANGE_CENTS && delta / base >= MIN_CHANGE_RATIO;
      })
      .sort((a, b) => Math.abs(b.cents - b.previousCents) - Math.abs(a.cents - a.previousCents))
      .slice(0, 5),
    biggest: rows
      .filter((tx) => tx.type === "EXPENSE" && tx.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 5)
      .map((tx) => ({
        dateYmd: ymdFromDateUtc(tx.date),
        title: tx.merchantName || tx.title || tx.categoryName,
        cents: tx.amountCents,
      })),
    budgetsKept: kept.sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
    budgetsMissed: missed.sort((a, b) => b.spentCents - b.limitCents - (a.spentCents - a.limitCents)),
  };
}

/** The month a review is for by default: the one just finished. */
export function defaultRecapYm(todayYmd: string): string {
  return shiftYm(todayYmd.slice(0, 7), -1);
}
