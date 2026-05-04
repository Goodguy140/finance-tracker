/** Calendar month as `YYYY-MM` (UTC-agnostic; aligned with existing month helpers). */
export type DashboardRange = "month" | "ytd" | "lifetime";

export type ParsedDashboardPeriod = {
  range: DashboardRange;
  /** Anchor month `YYYY-MM`: viewed month, YTD through-month, or stable picker value for lifetime. */
  ym: string;
  /** Spread into Prisma `where` for `Transaction.date` (empty for lifetime = no date filter). */
  transactionDateFilter: { date: { gte: Date; lt: Date } } | Record<string, never>;
};

export function currentPeriodYm(reference = new Date()): string {
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function parseDashboardRangeParam(raw: string | undefined): DashboardRange {
  if (raw === "ytd" || raw === "lifetime" || raw === "month") return raw;
  return "month";
}

export function startOfMonthYm(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
}

/** Jan 1 UTC of the calendar year containing `ym`. */
export function startOfCalendarYearForYm(ym: string): Date {
  const y = Number(ym.slice(0, 4));
  return new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
}

/** First instant after the last day of `ym`. */
export function endExclusiveOfMonthYm(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
}

/** Shift calendar month by `deltaMonths` (negative = earlier). */
export function shiftYm(ym: string, deltaMonths: number): string {
  const [y, mo] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + deltaMonths, 1, 0, 0, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First `YYYY-MM` of the calendar year of `ym`. */
export function ytdFirstMonthYm(ym: string): string {
  return `${ym.slice(0, 4)}-01`;
}

/** Whether a budget `periodMonth` counts toward YTD sums for anchor `ym` (same calendar year, Jan through `ym`). */
export function budgetPeriodMonthInYtd(periodMonth: string, anchorYm: string): boolean {
  const year = anchorYm.slice(0, 4);
  const start = ytdFirstMonthYm(anchorYm);
  return periodMonth.slice(0, 4) === year && periodMonth >= start && periodMonth <= anchorYm;
}

export function parseDashboardSearchParams(
  params: { month?: string | string[]; range?: string | string[] },
  reference = new Date(),
): ParsedDashboardPeriod {
  const monthRaw = firstParam(params.month);
  const rangeRaw = firstParam(params.range);
  const defaultYm = currentPeriodYm(reference);

  if (monthRaw === "all") {
    return {
      range: "lifetime",
      ym: defaultYm,
      transactionDateFilter: {},
    };
  }

  const ym =
    monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : defaultYm;
  const range = parseDashboardRangeParam(rangeRaw);

  if (range === "lifetime") {
    return { range, ym, transactionDateFilter: {} };
  }
  if (range === "ytd") {
    return {
      range,
      ym,
      transactionDateFilter: {
        date: {
          gte: startOfCalendarYearForYm(ym),
          lt: endExclusiveOfMonthYm(ym),
        },
      },
    };
  }
  return {
    range: "month",
    ym,
    transactionDateFilter: {
      date: {
        gte: startOfMonthYm(ym),
        lt: endExclusiveOfMonthYm(ym),
      },
    },
  };
}

export function describeDashboardPeriod(parsed: ParsedDashboardPeriod): string {
  if (parsed.range === "lifetime") return "Lifetime";
  if (parsed.range === "month") {
    return new Date(startOfMonthYm(parsed.ym)).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const y = Number(parsed.ym.slice(0, 4));
  const m = Number(parsed.ym.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(y, 0, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const from = start.toLocaleString(undefined, { month: "short" });
  const to = end.toLocaleString(undefined, { month: "short", year: "numeric" });
  return `Year to date (${from}–${to})`;
}
