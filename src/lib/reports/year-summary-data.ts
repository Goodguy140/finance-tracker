import { getCountryConfig } from "@/lib/country-config";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { yearsWithActivity } from "@/lib/reports";
import { loadActivityBounds, loadReportTxs } from "@/lib/reports/load";
import { buildYearSummary, yearWindow } from "@/lib/reports/year-summary";
import { listTags } from "@/lib/tags-server";

/**
 * What the year-end page shows (`/reports/year`), loaded once for it and for the phone
 * (`GET /api/v1/reports/year`): the years there is activity in, the one picked (last year by
 * default once there is one, since that is the one a tax return is for), and its summary.
 */
export async function loadYearEndReport(
  user: { id: string; countryCode: string | null; timezone: string | null },
  rawYear: string | undefined,
  now: Date = new Date(),
) {
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const [activityYears, tags] = await Promise.all([loadActivityBounds(user.id), listTags(prisma, user.id)]);
  const years = yearsWithActivity(activityYears, todayYmd);
  const year = Number(rawYear && years.includes(rawYear) ? rawYear : (years.find((y) => y < todayYmd.slice(0, 4)) ?? years[0]));
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const window = yearWindow(year, todayYmd);
  const [txs, flows] = await Promise.all([
    loadReportTxs(user.id, new Date(Date.UTC(year - 1, 0, 1)), currency),
    prisma.investmentFlow.findMany({
      where: { userId: user.id, date: { gte: window.start, lt: window.end } },
      select: { accountId: true, date: true, direction: true, amountCents: true, account: { select: { name: true, type: true } } },
    }),
  ]);
  const summary = buildYearSummary({
    year,
    todayYmd,
    txs,
    tags,
    flows: flows.map((f) => ({ ...f, accountName: f.account.name, accountType: f.account.type })),
  });
  const spendingChangePercent =
    summary.previousSpendingCents > 0
      ? Math.round(((summary.spendingCents - summary.previousSpendingCents) / summary.previousSpendingCents) * 100)
      : null;
  // The last day the totals run to: the year's last, or today in the year now running.
  const lastDay = new Date(window.end.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { years, year, currency, summary, spendingChangePercent, lastDay };
}

export type YearEndReport = Awaited<ReturnType<typeof loadYearEndReport>>;
