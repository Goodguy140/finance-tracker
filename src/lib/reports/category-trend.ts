import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { formatYmShortLabel, shiftYm } from "@/lib/dashboard-period";
import { categoryAmounts } from "@/lib/insights/facts";
import { merchantKeyFor, merchantLabelFor, mostCommon, ymOf } from "@/lib/insights/util";
import type { ReportTx } from "./index";

/** How many months the chart shows at most, this one included. */
export const TREND_MONTHS = 24;
/** The average is over the last this-many full months (fewer for a newer category). */
const AVERAGE_MONTHS = 12;
const LIST_LIMIT = 8;

export type CategoryTrendMonth = {
  ym: string;
  label: string;
  cents: number;
  /** The monthly budget in force that month (before rollover); null when there was none. */
  budgetCents: number | null;
};

export type CategoryTrendPayee = { key: string; label: string; cents: number; count: number };
export type CategoryTrendPurchase = { id: string; date: Date; title: string; cents: number; split: boolean };

export type CategoryTrend = {
  /** Every month from the first one with anything in the category (at most `TREND_MONTHS` back) to this one. */
  months: CategoryTrendMonth[];
  /** Mean of the full months shown, up to the last twelve; null when there is none yet. */
  averageCents: number | null;
  averageMonths: number;
  thisMonth: {
    cents: number;
    /** Where the month ends at the rate so far; null on the first day, too early to say. */
    paceCents: number | null;
    budgetCents: number | null;
  };
  payees: CategoryTrendPayee[];
  biggest: CategoryTrendPurchase[];
};

/**
 * One category over time: what went into it each month against its budget, its usual month,
 * where this month is heading, and who the money went to. An expense category counts expenses
 * (refunds net off, split parts count toward their own categories); an income category counts
 * income. Null when nothing has ever been filed under it.
 */
export function categoryTrend(input: {
  txs: readonly ReportTx[];
  categoryId: string;
  kind: "EXPENSE" | "INCOME";
  /** The category's monthly budgets, any months. */
  budgets: ReadonlyArray<{ periodMonth: string; limitCents: number }>;
  todayYmd: string;
}): CategoryTrend | null {
  const { txs, categoryId, kind, budgets, todayYmd } = input;
  const rows: Array<{ tx: ReportTx; cents: number; split: boolean }> = [];
  for (const tx of txs) {
    if (tx.type !== kind) continue;
    for (const part of categoryAmounts(tx)) {
      if (part.categoryId === categoryId) rows.push({ tx, cents: part.amountCents, split: tx.splits.length > 0 });
    }
  }
  if (rows.length === 0) return null;

  const currentYm = todayYmd.slice(0, 7);
  const firstYm = rows.reduce((min, r) => (ymOf(r.tx.date) < min ? ymOf(r.tx.date) : min), currentYm);
  const startYm = firstYm > shiftYm(currentYm, -(TREND_MONTHS - 1)) ? firstYm : shiftYm(currentYm, -(TREND_MONTHS - 1));
  const span: string[] = [];
  for (let ym = startYm; ym <= currentYm; ym = shiftYm(ym, 1)) span.push(ym);
  const crossesYears = new Set(span.map((ym) => ym.slice(0, 4))).size > 1;

  const byMonth = new Map(span.map((ym) => [ym, 0]));
  for (const r of rows) {
    const ym = ymOf(r.tx.date);
    if (byMonth.has(ym)) byMonth.set(ym, byMonth.get(ym)! + r.cents);
  }
  const budgetRows = budgets.map((b) => ({ ...b, categoryId }));
  const months = span.map((ym) => ({
    ym,
    label: formatYmShortLabel(ym, crossesYears),
    cents: byMonth.get(ym)!,
    budgetCents: selectActiveBudgetsByCategory(budgetRows, ym).get(categoryId)?.limitCents ?? null,
  }));

  const full = months.filter((m) => m.ym < currentYm).slice(-AVERAGE_MONTHS);
  const current = months[months.length - 1];
  const day = Number(todayYmd.slice(8, 10));
  const [y, mo] = currentYm.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();

  const payeeRows = new Map<string, Array<{ tx: ReportTx; cents: number }>>();
  for (const r of rows) {
    const key = merchantKeyFor(r.tx);
    if (!key) continue;
    payeeRows.set(key, [...(payeeRows.get(key) ?? []), r]);
  }
  const payees = [...payeeRows]
    .map(([key, list]) => ({
      key,
      label: mostCommon(list.map((r) => merchantLabelFor(r.tx))) ?? key,
      cents: list.reduce((sum, r) => sum + r.cents, 0),
      count: list.length,
    }))
    .filter((p) => p.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label))
    .slice(0, LIST_LIMIT);

  const biggest = rows
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents || b.tx.date.getTime() - a.tx.date.getTime())
    .slice(0, LIST_LIMIT)
    .map((r) => ({
      id: r.tx.id,
      date: r.tx.date,
      title: r.tx.title || r.tx.merchantName || "Untitled",
      cents: r.cents,
      split: r.split,
    }));

  return {
    months,
    averageCents: full.length ? Math.round(full.reduce((sum, m) => sum + m.cents, 0) / full.length) : null,
    averageMonths: full.length,
    thisMonth: {
      cents: current.cents,
      paceCents: day > 1 ? Math.round((current.cents / day) * daysInMonth) : null,
      budgetCents: current.budgetCents,
    },
    payees,
    biggest,
  };
}
