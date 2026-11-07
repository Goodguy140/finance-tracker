import { CategoryKind, type PrismaClient } from "@prisma/client";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { homeCurrencyOf } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma as defaultDb } from "@/lib/prisma";
import { merchantActivity, type MerchantActivity } from "@/lib/reports";
import { categoryTrend, TREND_MONTHS, type CategoryTrend } from "@/lib/reports/category-trend";
import { loadReportTxs } from "@/lib/reports/load";

/**
 * One category over time and everything from one payee, loaded once for the website's
 * `/reports/category` and `/reports/merchant` and for the phone (`/api/v1/categories/:id/trend`,
 * `/api/v1/merchants`), so both show the same months, payees and totals.
 */

type ReportUser = { id: string; timezone: string | null; countryCode: string | null };

export type LoadedCategoryTrend = {
  category: { id: string; name: string; kind: CategoryKind; groupName: string | null };
  currency: string;
  /** Null when nothing has been filed under the category in the last `TREND_MONTHS` months. */
  trend: CategoryTrend | null;
};

/** The user's expense or income category over the last two years; null when it is not theirs. */
export async function loadCategoryTrend(
  user: ReportUser,
  categoryId: string,
  db: PrismaClient = defaultDb,
): Promise<LoadedCategoryTrend | null> {
  const category = await db.category.findFirst({
    where: { id: categoryId, userId: user.id, kind: { in: [CategoryKind.EXPENSE, CategoryKind.INCOME] } },
    select: { id: true, name: true, kind: true, groupName: true },
  });
  if (!category) return null;
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const since = startOfMonthYm(shiftYm(todayYmd.slice(0, 7), -(TREND_MONTHS - 1)));
  const [txs, budgets] = await Promise.all([
    loadReportTxs(user.id, since, currency),
    db.budget.findMany({ where: { userId: user.id, categoryId: category.id }, select: { periodMonth: true, limitCents: true } }),
  ]);
  const kind = category.kind === CategoryKind.INCOME ? "INCOME" : "EXPENSE";
  return { category, currency, trend: categoryTrend({ txs, categoryId: category.id, kind, budgets, todayYmd }) };
}

/** Everything from one payee, by the key the reports gave it, across all history; null when nothing matches. */
export async function loadMerchantActivity(
  user: ReportUser,
  key: string,
): Promise<{ currency: string; activity: MerchantActivity } | null> {
  const currency = homeCurrencyOf(user.countryCode);
  const activity = merchantActivity(await loadReportTxs(user.id, null, currency), key);
  return activity ? { currency, activity } : null;
}
