"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseDashboardRangeParam } from "@/lib/dashboard-period";

function rollingMonthChoices(count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i += 1) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const value = `${y}-${String(m).padStart(2, "0")}`;
    out.push({
      value,
      label: d.toLocaleString(undefined, { month: "long", year: "numeric" }),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const selectClass =
  "rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20";

const RANGE_OPTIONS: { value: "month" | "ytd" | "lifetime"; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "ytd", label: "Year to date" },
  { value: "lifetime", label: "Lifetime" },
];

function pushQuery(
  pathname: string,
  router: ReturnType<typeof useRouter>,
  searchParams: URLSearchParams,
  updates: { range?: string; month?: string },
) {
  const next = new URLSearchParams(searchParams.toString());
  if (updates.range !== undefined) {
    if (updates.range === "month") next.delete("range");
    else next.set("range", updates.range);
  }
  if (updates.month !== undefined) {
    next.set("month", updates.month);
  }
  const q = next.toString();
  router.push(q ? `${pathname}?${q}` : pathname);
}

export function DashboardMonthFilter({ anchorYm }: { anchorYm: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = useMemo(() => rollingMonthChoices(48), []);

  const rawMonth = searchParams.get("month");
  const legacyAll = rawMonth === "all";
  const selectedYm =
    rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : anchorYm;
  const range = legacyAll ? "lifetime" : parseDashboardRangeParam(searchParams.get("range") ?? undefined);
  const rangeSelectValue = range;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">View</span>
        <select
          className={`${selectClass} min-w-[10rem]`}
          value={rangeSelectValue}
          onChange={(event) => {
            const v = event.target.value as "month" | "ytd" | "lifetime";
            const nextMonth = legacyAll ? anchorYm : selectedYm;
            pushQuery(pathname, router, searchParams, { range: v, month: nextMonth });
          }}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Month</span>
        <select
          className={`${selectClass} min-w-[11rem]`}
          value={selectedYm}
          onChange={(event) => {
            const v = event.target.value;
            pushQuery(pathname, router, searchParams, { month: v });
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
