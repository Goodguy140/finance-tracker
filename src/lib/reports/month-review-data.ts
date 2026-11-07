import { PlaidStagedStatus, type PrismaClient } from "@prisma/client";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { endExclusiveOfMonthYm, shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { homeCurrencyOf } from "@/lib/home-currency";
import { currentYmdInTimeZone, isValidYm } from "@/lib/period-month";
import { prisma as defaultDb } from "@/lib/prisma";
import { loadReportTxs } from "@/lib/reports/load";
import { buildMonthRecap, defaultRecapYm, type MonthRecap } from "@/lib/reports/month-recap";

/**
 * Everything the monthly review shows for one month, loaded once for the website's
 * `/reports/month` and the phone's `GET /api/v1/month-review`, so both say the same thing.
 */

export type MonthReview = {
  ym: string;
  currentYm: string;
  currency: string;
  recap: MonthRecap;
  /** Whether each budget's leftover or overspend carries into next month, by category name. */
  rolloverByName: Map<string, boolean>;
  /** Bank rows dated this month still waiting in the review queue. */
  bankRowsWaiting: number;
  /** Imported, auto-posted or API entries this month nobody has looked at. */
  entriesNeedingReview: number;
  closedAt: Date | null;
  scoreNow: number | null;
  scoreBefore: number | null;
};

/** The month asked for if it is a real one no later than this month; otherwise the one just finished. */
export function reviewMonth(raw: string | null | undefined, timezone: string | null): { ym: string; currentYm: string } {
  const todayYmd = currentYmdInTimeZone(timezone);
  const currentYm = todayYmd.slice(0, 7);
  return { ym: raw && isValidYm(raw) && raw <= currentYm ? raw : defaultRecapYm(todayYmd), currentYm };
}

export async function loadMonthReview(
  user: { id: string; timezone: string | null; countryCode: string | null },
  raw: string | null | undefined,
  db: PrismaClient = defaultDb,
): Promise<MonthReview> {
  const { ym, currentYm } = reviewMonth(raw, user.timezone);
  const currency = homeCurrencyOf(user.countryCode);
  const range = { gte: startOfMonthYm(ym), lt: endExclusiveOfMonthYm(ym) };

  const [txs, progress, categories, bankRowsWaiting, closed, entriesNeedingReview, scores] = await Promise.all([
    loadReportTxs(user.id, startOfMonthYm(shiftYm(ym, -1)), currency),
    buildMonthlyBudgetProgress(user.id, ym, db),
    db.category.findMany({ where: { userId: user.id }, select: { id: true, rolloverSinceMonth: true } }),
    db.plaidStagedTransaction.count({ where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW, date: range } }),
    db.monthClose.findUnique({ where: { userId_ym: { userId: user.id, ym } } }),
    // The log's Needs review filter, for this month.
    db.transaction.count({ where: { userId: user.id, needsReview: true, date: range } }),
    // The financial score as saved for this month and the one before (`FinancialScoreSnapshot`).
    db.financialScoreSnapshot.findMany({
      where: { userId: user.id, month: { in: [ym, shiftYm(ym, -1)] } },
      select: { month: true, score: true },
    }),
  ]);
  const rolloverOn = new Set(categories.filter((c) => c.rolloverSinceMonth !== null && c.rolloverSinceMonth <= ym).map((c) => c.id));
  const recap = buildMonthRecap({
    ym,
    txs,
    budgets: progress.budgets.map((b) => ({
      categoryName: b.categoryName,
      spentCents: b.spentCents,
      limitCents: b.limitCents,
      carryCents: b.carryCents,
    })),
  });
  return {
    ym,
    currentYm,
    currency,
    recap,
    rolloverByName: new Map(progress.budgets.map((b) => [b.categoryName, rolloverOn.has(b.categoryId)])),
    bankRowsWaiting,
    entriesNeedingReview,
    closedAt: closed?.closedAt ?? null,
    scoreNow: scores.find((s) => s.month === ym)?.score ?? null,
    scoreBefore: scores.find((s) => s.month === shiftYm(ym, -1))?.score ?? null,
  };
}

/** Marks a month reviewed. Idempotent: closing it again keeps the first date. A record only; nothing is locked. */
export async function closeMonth(db: PrismaClient, userId: string, ym: string): Promise<void> {
  await db.monthClose.upsert({ where: { userId_ym: { userId, ym } }, create: { userId, ym }, update: {} });
}

export async function reopenMonth(db: PrismaClient, userId: string, ym: string): Promise<void> {
  await db.monthClose.deleteMany({ where: { userId, ym } });
}
