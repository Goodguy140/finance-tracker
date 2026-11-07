import { CategoryKind } from "@prisma/client";
import { ymdFromDateUtc } from "@/lib/date-only";
import type { LoadedCategoryTrend } from "@/lib/reports/category-merchant-data";
import type { MerchantActivity } from "@/lib/reports";

/** The website's category trend (`/reports/category`) and payee (`/reports/merchant`) pages as JSON for the phone. */

/** The newest entries a payee answer lists; the totals still count every one. */
export const MERCHANT_TRANSACTION_LIMIT = 200;

export function serializeCategoryTrend({ category, currency, trend }: LoadedCategoryTrend) {
  return {
    categoryId: category.id,
    name: category.name,
    kind: category.kind === CategoryKind.INCOME ? ("income" as const) : ("expense" as const),
    groupName: category.groupName,
    currency,
    /** Oldest first, from the first month with anything in it (at most 24 back) to this one. Empty when nothing was filed. */
    months: (trend?.months ?? []).map((m) => ({ month: m.ym, label: m.label, cents: m.cents, budgetCents: m.budgetCents })),
    averageCents: trend?.averageCents ?? null,
    averageMonths: trend?.averageMonths ?? 0,
    /** Null when nothing was filed in the last 24 months. */
    thisMonth: trend ? trend.thisMonth : null,
    payees: trend?.payees ?? [],
    biggest: (trend?.biggest ?? []).map((t) => ({ id: t.id, date: ymdFromDateUtc(t.date), title: t.title, cents: t.cents, split: t.split })),
  };
}

export function serializeMerchant(
  { currency, activity }: { currency: string; activity: MerchantActivity },
  limit: number = MERCHANT_TRANSACTION_LIMIT,
) {
  const expenses = activity.transactions.filter((t) => t.type === "EXPENSE");
  return {
    key: activity.key,
    label: activity.label,
    currency,
    firstDate: ymdFromDateUtc(activity.firstDate),
    lastDate: ymdFromDateUtc(activity.lastDate),
    spentCents: activity.spentCents,
    receivedCents: activity.receivedCents,
    count: activity.count,
    /** Per expense, as the website works it out; null with none. */
    averageCents: expenses.length > 0 ? Math.round(activity.spentCents / expenses.length) : null,
    months: activity.months.map((m) => ({ month: m.ym, label: m.label, spentCents: m.spentCents, receivedCents: m.receivedCents })),
    categories: activity.categories,
    /** Newest first, at most `limit` of them; `count` says how many there are. */
    transactions: activity.transactions.slice(0, limit).map((t) => ({
      id: t.id,
      date: ymdFromDateUtc(t.date),
      title: t.title || t.merchantName || "",
      type: t.type === "INCOME" ? ("income" as const) : ("expense" as const),
      amountCents: t.amountCents,
      categoryName: t.splits.length ? null : t.categoryName,
      split: t.splits.length > 0,
    })),
  };
}
