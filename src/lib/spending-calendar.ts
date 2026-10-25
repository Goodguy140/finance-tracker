/**
 * The Calendar card's month grid: each day's spending and income from the log, and the
 * recurring bills and pay still to come. Weeks start on Sunday; days outside the month pad the
 * first and last week so every row has seven cells.
 */
export type CalendarEntry = { dateYmd: string; cents: number };
export type CalendarBill = { dateYmd: string; name: string; type: "INCOME" | "EXPENSE"; cents: number; overdue: boolean };

export type CalendarDay = {
  dateYmd: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  spentCents: number;
  incomeCents: number;
  count: number;
  bills: CalendarBill[];
};

export type CalendarMonth = {
  ym: string;
  weeks: CalendarDay[][];
  spentCents: number;
  incomeCents: number;
  /** The day with the most spending, or null in a month with none. */
  busiestYmd: string | null;
};

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildCalendarMonth(input: {
  ym: string;
  todayYmd: string;
  expenses: readonly CalendarEntry[];
  incomes: readonly CalendarEntry[];
  bills: readonly CalendarBill[];
}): CalendarMonth {
  const [y, m] = input.ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const totalCells = Math.ceil((first.getUTCDay() + daysInMonth) / 7) * 7;

  const spent = new Map<string, number>();
  const count = new Map<string, number>();
  for (const e of input.expenses) {
    spent.set(e.dateYmd, (spent.get(e.dateYmd) ?? 0) + e.cents);
    count.set(e.dateYmd, (count.get(e.dateYmd) ?? 0) + 1);
  }
  const income = new Map<string, number>();
  for (const e of input.incomes) {
    income.set(e.dateYmd, (income.get(e.dateYmd) ?? 0) + e.cents);
    count.set(e.dateYmd, (count.get(e.dateYmd) ?? 0) + 1);
  }
  const bills = new Map<string, CalendarBill[]>();
  for (const b of input.bills) bills.set(b.dateYmd, [...(bills.get(b.dateYmd) ?? []), b]);

  const weeks: CalendarDay[][] = [];
  let monthSpent = 0;
  let monthIncome = 0;
  let busiest: { ymd: string; cents: number } | null = null;
  for (let i = 0; i < totalCells; i += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = ymd(date);
    const inMonth = key.slice(0, 7) === input.ym;
    const day: CalendarDay = {
      dateYmd: key,
      day: date.getUTCDate(),
      inMonth,
      isToday: key === input.todayYmd,
      spentCents: inMonth ? (spent.get(key) ?? 0) : 0,
      incomeCents: inMonth ? (income.get(key) ?? 0) : 0,
      count: inMonth ? (count.get(key) ?? 0) : 0,
      bills: inMonth ? (bills.get(key) ?? []) : [],
    };
    if (inMonth) {
      monthSpent += day.spentCents;
      monthIncome += day.incomeCents;
      if (day.spentCents > 0 && (!busiest || day.spentCents > busiest.cents)) busiest = { ymd: key, cents: day.spentCents };
    }
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return { ym: input.ym, weeks, spentCents: monthSpent, incomeCents: monthIncome, busiestYmd: busiest?.ymd ?? null };
}

/** The dashboard link that shows one day's entries in the log: a one-day custom range. */
export function dayLogHref(dateYmd: string): string {
  return `/?range=custom&from=${dateYmd}&to=${dateYmd}`;
}
