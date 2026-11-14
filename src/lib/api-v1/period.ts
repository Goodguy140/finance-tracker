import { parseCustomRange } from "@/lib/date-range";
import {
  describeDashboardPeriod,
  parseDashboardSearchParams,
  ytdFirstMonthYm,
  type ParsedDashboardPeriod,
} from "@/lib/dashboard-period";
import { monthParamSchema } from "@/lib/validation";

/**
 * The period a phone screen asks for, as the dashboard's period filter reads it: a month
 * (`?month=YYYY-MM`, this month when left out), year to date through a month (`?range=ytd`), or a
 * custom range of days (`?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`, both included). Unlike the
 * dashboard, a bad value is refused rather than quietly shown as this month.
 */

export type AppPeriodRange = "month" | "ytd" | "custom";

export function parseAppPeriod(
  params: URLSearchParams,
  timeZone: string | null,
  now: Date = new Date(),
): { ok: true; period: ParsedDashboardPeriod } | { ok: false; error: string } {
  const month = params.get("month");
  if (month !== null && !monthParamSchema.safeParse(month).success) {
    return { ok: false, error: "Invalid 'month' parameter — expected YYYY-MM." };
  }
  const range = params.get("range") ?? "month";
  if (range !== "month" && range !== "ytd" && range !== "custom") {
    return { ok: false, error: "Invalid 'range' parameter — expected month, ytd or custom." };
  }
  const from = params.get("from");
  const to = params.get("to");
  if (range === "custom" && !parseCustomRange(from, to)) {
    return { ok: false, error: "A custom range needs 'from' and 'to' as YYYY-MM-DD, 'from' on or before 'to'." };
  }
  const period = parseDashboardSearchParams(
    { month: month ?? undefined, range, from: from ?? undefined, to: to ?? undefined },
    now,
    timeZone,
  );
  return { ok: true, period };
}

/** The period as the phone shows it: which kind, its first and last day, and the website's label for it. */
export function serializeAppPeriod(period: ParsedDashboardPeriod) {
  const range = period.range as AppPeriodRange;
  const [y, m] = period.ym.split("-").map(Number);
  const lastDay = `${period.ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return {
    range,
    from: period.custom?.fromYmd ?? `${range === "ytd" ? ytdFirstMonthYm(period.ym) : period.ym}-01`,
    to: period.custom?.toYmd ?? lastDay,
    label: describeDashboardPeriod(period),
  };
}
