import { z } from "zod";
import { ymdFromDateUtc } from "@/lib/date-only";
import { isValidYm } from "@/lib/period-month";
import type { MonthReview } from "@/lib/reports/month-review-data";

/** The website's monthly review (`/reports/month`) as JSON for the phone. */
export function serializeMonthReview(review: MonthReview) {
  const { recap } = review;
  // Over budget first, the most over leading; then those kept, by name — as the website lists them.
  const budgets = [...recap.budgetsMissed, ...recap.budgetsKept].map((b) => ({
    categoryName: b.categoryName,
    spentCents: b.spentCents,
    limitCents: b.limitCents,
    /** Its leftover or overspend carries into next month. */
    rollsOver: review.rolloverByName.get(b.categoryName) ?? false,
  }));
  return {
    month: review.ym,
    currentMonth: review.currentYm,
    /** The month is still running: totals are to today. */
    running: review.ym === review.currentYm,
    currency: review.currency,
    incomeCents: recap.incomeCents,
    spendingCents: recap.spendingCents,
    netCents: recap.netCents,
    previousIncomeCents: recap.previousIncomeCents,
    previousSpendingCents: recap.previousSpendingCents,
    transactionCount: recap.transactionCount,
    categories: recap.categories,
    changes: recap.changes,
    biggest: recap.biggest.map((b) => ({ date: b.dateYmd, title: b.title, cents: b.cents })),
    budgets,
    budgetsKept: recap.budgetsKept.length,
    bankRowsWaiting: review.bankRowsWaiting,
    entriesNeedingReview: review.entriesNeedingReview,
    score: review.scoreNow,
    previousScore: review.scoreBefore,
    closedOn: review.closedAt ? ymdFromDateUtc(review.closedAt) : null,
  };
}

export type AppMonthReview = ReturnType<typeof serializeMonthReview>;

const closeBody = z
  .object({ month: z.string().refine(isValidYm, "Send month as YYYY-MM."), closed: z.boolean() })
  .strict();

/** `{ month, closed }`: mark the month closed, or reopen it; a month after this one can't be closed. */
export function parseCloseBody(body: unknown, currentYm: string): { ok: true; month: string; closed: boolean } | { ok: false; error: string } {
  const parsed = closeBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Send { month, closed }." };
  if (parsed.data.month > currentYm) return { ok: false, error: "A month that hasn't started can't be closed." };
  return { ok: true, ...parsed.data };
}
