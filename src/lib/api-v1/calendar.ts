import { TransactionType, type PrismaClient } from "@prisma/client";
import { calendarBillsFor } from "@/lib/bills-forecast-list";
import { loadCardTerms } from "@/lib/credit-cards-data";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { plannedAsForecastRules } from "@/lib/planned-transactions";
import { loadOpenPlannedTransactions } from "@/lib/planned-transactions-data";
import { buildCalendarMonth } from "@/lib/spending-calendar";

/**
 * The dashboard's Calendar card for the phone: a month as a Sunday-first grid, each day's spending
 * and income from the log, and dots for the bills, pay, plans, transfers and card payments still to
 * come. In the home currency, as the card is.
 */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseCalendarMonth(raw: string | null, todayYmd: string): { ok: true; ym: string } | { ok: false; error: string } {
  if (!raw) return { ok: true, ym: todayYmd.slice(0, 7) };
  return YM.test(raw) ? { ok: true, ym: raw } : { ok: false, error: "'month' must be YYYY-MM." };
}

type CalendarUser = { id: string; timezone: string | null; countryCode: string | null };

export async function loadAppCalendar(db: PrismaClient, user: CalendarUser, rawMonth: string | null, now: Date = new Date()) {
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const parsed = parseCalendarMonth(rawMonth, todayYmd);
  if (!parsed.ok) return parsed;
  const { ym } = parsed;
  const currency = homeCurrencyOf(user.countryCode);
  const from = dateFromYmd(`${ym}-01`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const inMonth = { userId: user.id, date: { gte: from, lt: to }, ...inCurrencyWhere(currency) };
  const [expenses, incomes, rules, plans, cardTerms] = await Promise.all([
    db.transaction.findMany({ where: { ...inMonth, type: TransactionType.EXPENSE }, select: { date: true, amountCents: true } }),
    db.transaction.findMany({ where: { ...inMonth, type: TransactionType.INCOME }, select: { date: true, amountCents: true } }),
    db.recurringTransaction.findMany({
      where: { userId: user.id, account: { currency } },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        transferAccount: { select: { name: true } },
      },
    }),
    loadOpenPlannedTransactions(user.id, { currency }, db),
    // A failure costs the card payments only, as on the dashboard.
    loadCardTerms(db, user.id, currency).catch((err) => {
      console.error("[cards] loading due days failed", err);
      return [];
    }),
  ]);
  const month = buildCalendarMonth({
    ym,
    todayYmd,
    expenses: expenses.map((t) => ({ dateYmd: ymdFromDateUtc(t.date), cents: t.amountCents })),
    incomes: incomes.map((t) => ({ dateYmd: ymdFromDateUtc(t.date), cents: t.amountCents })),
    bills: calendarBillsFor({
      rules: [...rules, ...plannedAsForecastRules(plans)],
      cardRules: rules,
      cardTerms,
      todayYmd,
      currentYm: todayYmd.slice(0, 7),
      ym,
    }),
  });
  return {
    ok: true as const,
    month: month.ym,
    today: todayYmd,
    currency,
    spentCents: month.spentCents,
    incomeCents: month.incomeCents,
    busiest: month.busiestYmd,
    weeks: month.weeks.map((week) =>
      week.map((day) => ({
        date: day.dateYmd,
        day: day.day,
        inMonth: day.inMonth,
        spentCents: day.spentCents,
        incomeCents: day.incomeCents,
        count: day.count,
        bills: day.bills.map((b) => ({
          name: b.name,
          type: b.type.toLowerCase() as "expense" | "income" | "transfer",
          cents: b.cents,
          overdue: b.overdue,
          planned: b.planned === true,
          cardPayment: b.cardPayment === true,
        })),
      })),
    ),
  };
}
