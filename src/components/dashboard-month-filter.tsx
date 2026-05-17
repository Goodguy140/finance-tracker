"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatMonthYearYm, parseDashboardRangeParam, shiftYm } from "@/lib/dashboard-period";

const chipClass =
  "touch-manipulation rounded-full border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";
const chipInactive =
  "border-slate-600 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800";
const chipActive = "border-blue-400/70 bg-blue-500/15 text-blue-100 ring-1 ring-blue-500/30";

const navBtnClass =
  "touch-manipulation flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-900/80 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

function pushQuery(
  pathname: string,
  router: ReturnType<typeof useRouter>,
  searchParams: URLSearchParams,
  updates: { range?: string | null; month?: string | null; preset?: string | null },
) {
  const next = new URLSearchParams(searchParams.toString());
  if (updates.range !== undefined) {
    if (updates.range === null || updates.range === "month") next.delete("range");
    else next.set("range", updates.range);
  }
  if (updates.month !== undefined) {
    if (updates.month === null) next.delete("month");
    else next.set("month", updates.month);
  }
  if (updates.preset !== undefined) {
    if (updates.preset === null) next.delete("preset");
    else next.set("preset", updates.preset);
  }
  const q = next.toString();
  router.push(q ? `${pathname}?${q}` : pathname);
}

function formatYmHeading(ym: string): string {
  return formatMonthYearYm(ym);
}

export function DashboardMonthFilter({ anchorYm }: { anchorYm: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawMonth = searchParams.get("month");
  const preset = searchParams.get("preset");
  const legacyAll = rawMonth === "all";
  const previousCalendarYm = shiftYm(anchorYm, -1);
  const selectedYm =
    !legacyAll && preset === "previous-month"
      ? previousCalendarYm
      : rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)
        ? rawMonth
        : anchorYm;
  const range =
    legacyAll || preset === null
      ? legacyAll
        ? "lifetime"
        : parseDashboardRangeParam(searchParams.get("range") ?? undefined)
      : preset === "previous-month"
        ? "month"
        : parseDashboardRangeParam(searchParams.get("range") ?? undefined);
  const isCurrentMonth =
    !legacyAll && range === "month" && selectedYm === anchorYm;
  const isPreviousMonth =
    !legacyAll && range === "month" && selectedYm === previousCalendarYm;
  const isYtdThroughCurrent = !legacyAll && range === "ytd" && selectedYm === anchorYm;
  const isLifetime = !legacyAll && range === "lifetime";

  const monthHeading = formatYmHeading(selectedYm);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick period">
        <button
          type="button"
          className={`${chipClass} ${isCurrentMonth ? chipActive : chipInactive}`}
          aria-pressed={isCurrentMonth}
          onClick={() => pushQuery(pathname, router, searchParams, { range: "month", month: null, preset: null })}
        >
          Current month
        </button>
        <button
          type="button"
          className={`${chipClass} ${isPreviousMonth ? chipActive : chipInactive}`}
          aria-pressed={isPreviousMonth}
          onClick={() =>
            pushQuery(pathname, router, searchParams, { range: "month", month: null, preset: "previous-month" })
          }
        >
          Previous month
        </button>
        <button
          type="button"
          className={`${chipClass} ${isYtdThroughCurrent ? chipActive : chipInactive}`}
          aria-pressed={isYtdThroughCurrent}
          onClick={() => pushQuery(pathname, router, searchParams, { range: "ytd", month: null, preset: null })}
        >
          YTD
        </button>
        <button
          type="button"
          className={`${chipClass} ${isLifetime ? chipActive : chipInactive}`}
          aria-pressed={isLifetime}
          onClick={() =>
            pushQuery(pathname, router, searchParams, {
              range: "lifetime",
              month: null,
              preset: null,
            })
          }
        >
          Lifetime
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950/50 px-1.5 py-0.5"
        role="group"
        aria-label="Selected month"
      >
        <button
          type="button"
          className={navBtnClass}
          aria-label="One month earlier"
          onClick={() =>
            pushQuery(pathname, router, searchParams, { month: shiftYm(selectedYm, -1), preset: null })
          }
        >
          <span aria-hidden className="leading-none">
            ←
          </span>
        </button>
        <span className="min-w-[8rem] flex-1 text-center text-xs font-medium tabular-nums leading-tight text-slate-100 sm:min-w-[9.5rem] sm:text-[13px]">
          {monthHeading}
        </span>
        <button
          type="button"
          className={navBtnClass}
          aria-label="One month later"
          onClick={() =>
            pushQuery(pathname, router, searchParams, { month: shiftYm(selectedYm, 1), preset: null })
          }
        >
          <span aria-hidden className="leading-none">
            →
          </span>
        </button>
      </div>
    </div>
  );
}
