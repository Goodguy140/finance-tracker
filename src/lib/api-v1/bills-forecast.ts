import type { PrismaClient } from "@prisma/client";
import { BILLS_FORECAST_DAY_OPTIONS, DEFAULT_BILLS_FORECAST_DAYS, type BillsForecastDays } from "@/lib/bills-forecast";
import { buildBillsForecastList, type BillsForecastList } from "@/lib/bills-forecast-list";
import { loadCardTerms } from "@/lib/credit-cards-data";
import { ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { plannedAsForecastRules } from "@/lib/planned-transactions";
import { loadOpenPlannedTransactions } from "@/lib/planned-transactions-data";

/** The dashboard's Upcoming bills card for the phone: 30, 60 or 90 days, day by day, with a running net. */

export function parseForecastQuery(params: URLSearchParams):
  | { ok: true; days: BillsForecastDays; includeTransfers: boolean }
  | { ok: false; error: string } {
  const rawDays = params.get("days");
  const days = rawDays ? (Number(rawDays) as BillsForecastDays) : DEFAULT_BILLS_FORECAST_DAYS;
  if (!BILLS_FORECAST_DAY_OPTIONS.includes(days)) return { ok: false, error: "'days' must be 30, 60 or 90." };
  const transfers = params.get("transfers");
  if (transfers !== null && transfers !== "true" && transfers !== "false") return { ok: false, error: "'transfers' must be true or false." };
  return { ok: true, days, includeTransfers: transfers !== "false" };
}

type ForecastUser = { id: string; timezone: string | null; countryCode: string | null };

/** What the card forecasts from, in the home currency as its totals are: rules that are on, open plans and cards' due days. */
export async function loadAppBillsForecast(
  db: PrismaClient,
  user: ForecastUser,
  options: { days: BillsForecastDays; includeTransfers: boolean },
  now: Date = new Date(),
) {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const [rules, plans, cardTerms] = await Promise.all([
    db.recurringTransaction.findMany({
      where: { userId: user.id, account: { currency } },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        transferAccount: { select: { name: true } },
      },
      orderBy: [{ nextExpectedDate: "asc" }, { id: "asc" }],
    }),
    loadOpenPlannedTransactions(user.id, { currency }, db),
    // A failure costs the card payments only, as on the dashboard.
    loadCardTerms(db, user.id, currency).catch((err) => {
      console.error("[cards] loading due days failed", err);
      return [];
    }),
  ]);
  const list = buildBillsForecastList({
    rules: [...rules, ...plannedAsForecastRules(plans)],
    cardRules: rules,
    cardTerms,
    todayYmd,
    currentYm: todayYmd.slice(0, 7),
    days: options.days,
    includeTransfers: options.includeTransfers,
  });
  return serializeBillsForecast(list, {
    today: todayYmd,
    currency,
    ...options,
    // Nothing to forecast from at all, so the phone can say how to start rather than "nothing due".
    sources: rules.filter((r) => r.enabled).length + plans.length + list.cardPaymentCount,
  });
}

export function serializeBillsForecast(
  list: BillsForecastList,
  meta: { today: string; currency: string; days: number; includeTransfers: boolean; sources: number },
) {
  return {
    ...meta,
    incomeCents: list.incomeCents,
    expenseCents: list.expenseCents,
    netCents: list.netCents,
    groups: list.days.map((day) => ({
      date: day.dateYmd,
      runningNetCents: day.runningNetCents,
      entries: day.entries.map((e) => ({
        key: e.key,
        sourceId: e.sourceId,
        name: e.name,
        type: e.type.toLowerCase() as "expense" | "income" | "transfer",
        amountCents: e.amountCents,
        overdue: e.overdue,
        missedSince: e.missedSince ? ymdFromDateUtc(e.missedSince) : null,
        planned: e.planned,
        label: e.label,
        card: e.card ? { owedCents: e.card.owedCents, minimumCents: e.card.minimumCents } : null,
        decideBy: e.decideBy ? ymdFromDateUtc(e.decideBy) : null,
      })),
    })),
  };
}
