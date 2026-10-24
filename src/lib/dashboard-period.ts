import { dateFromYmd } from "@/lib/date-only";
import { dayAfter, formatCustomRange, parseCustomRange, type CustomDateRange } from "@/lib/date-range";
import { currentYmInTimeZone, isValidYm } from "@/lib/period-month";

/** Calendar month as `YYYY-MM` (UTC-agnostic; aligned with existing month helpers). */
export type DashboardRange = "month" | "ytd" | "lifetime" | "custom";

export type ParsedDashboardPeriod = {
  range: DashboardRange;
  /** Anchor month `YYYY-MM`: viewed month, YTD through-month, or stable picker value for lifetime. */
  ym: string;
  /** Spread into Prisma `where` for `Transaction.date` (empty for lifetime = no date filter). */
  transactionDateFilter: { date: { gte: Date; lt: Date } } | Record<string, never>;
  /** The days picked, for a custom range; `ym` is then the month of its last day. */
  custom?: CustomDateRange;
};

type DashboardRelativePreset = "previous-month";

/** Calendar month (`YYYY-MM`) for `reference` in the host environment's local timezone. */
export function currentPeriodYm(reference = new Date()): string {
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function parseDashboardRangeParam(raw: string | undefined): DashboardRange {
  if (raw === "ytd" || raw === "lifetime" || raw === "month" || raw === "custom") return raw;
  return "month";
}

function parseDashboardRelativePreset(raw: string | undefined): DashboardRelativePreset | null {
  if (raw === "previous-month") return raw;
  return null;
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

const ymUtcLocale = { timeZone: "UTC" } as const;

/** Human-readable calendar month for `YYYY-MM` (uses UTC; avoids local TZ shifting the label). */
export function formatYmLongLabel(ym: string): string {
  return startOfMonthYm(ym).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    ...ymUtcLocale,
  });
}

/** Short month label for `YYYY-MM`, optionally including the year. */
export function formatYmShortLabel(ym: string, withYear = true): string {
  return startOfMonthYm(ym).toLocaleString(undefined, {
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    ...ymUtcLocale,
  });
}

/** Whether a budget `periodMonth` counts toward YTD sums for anchor `ym` (same calendar year, Jan through `ym`). */
export function budgetPeriodMonthInYtd(periodMonth: string, anchorYm: string): boolean {
  const year = anchorYm.slice(0, 4);
  const start = ytdFirstMonthYm(anchorYm);
  return periodMonth.slice(0, 4) === year && periodMonth >= start && periodMonth <= anchorYm;
}

/**
 * `timeZone` (the user's IANA zone) decides which calendar month "now" falls in; without
 * it the host clock is used, as before.
 */
export function parseDashboardSearchParams(
  params: {
    month?: string | string[];
    range?: string | string[];
    preset?: string | string[];
    from?: string | string[];
    to?: string | string[];
  },
  reference = new Date(),
  timeZone?: string | null,
): ParsedDashboardPeriod {
  const monthRaw = firstParam(params.month);
  const rangeRaw = firstParam(params.range);
  const presetRaw = firstParam(params.preset);
  const defaultYm = timeZone ? currentYmInTimeZone(timeZone, reference) : currentPeriodYm(reference);

  if (monthRaw === "all") {
    return {
      range: "lifetime",
      ym: defaultYm,
      transactionDateFilter: {},
    };
  }

  const preset = parseDashboardRelativePreset(presetRaw);
  if (preset === "previous-month") {
    const ym = shiftYm(defaultYm, -1);
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

  const ym = isValidYm(monthRaw) ? monthRaw : defaultYm;
  const range = parseDashboardRangeParam(rangeRaw);

  // A custom range without two valid, ordered days falls back to the month view.
  const custom = range === "custom" ? parseCustomRange(firstParam(params.from), firstParam(params.to)) : null;
  if (custom) {
    return {
      range: "custom",
      ym: custom.toYmd.slice(0, 7),
      custom,
      transactionDateFilter: { date: { gte: dateFromYmd(custom.fromYmd), lt: dayAfter(custom.toYmd) } },
    };
  }

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
  if (parsed.range === "custom" && parsed.custom) return formatCustomRange(parsed.custom);
  if (parsed.range === "month") {
    return formatYmLongLabel(parsed.ym);
  }
  const from = startOfCalendarYearForYm(parsed.ym).toLocaleString(undefined, {
    month: "short",
    ...ymUtcLocale,
  });
  const to = formatYmShortLabel(parsed.ym);
  return `Year to date (${from}–${to})`;
}
