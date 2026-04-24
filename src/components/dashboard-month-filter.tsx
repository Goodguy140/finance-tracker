"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

export function DashboardMonthFilter({ anchorYm }: { anchorYm: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = useMemo(() => rollingMonthChoices(48), []);

  const raw = searchParams.get("month");
  const selected =
    raw === "all" ? "all" : raw && /^\d{4}-\d{2}$/.test(raw) ? raw : anchorYm;

  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Period</span>
      <select
        className={`${selectClass} min-w-[11rem]`}
        value={selected}
        onChange={(event) => {
          const v = event.target.value;
          const next = new URLSearchParams(searchParams.toString());
          if (v === "all") next.set("month", "all");
          else next.set("month", v);
          const q = next.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="all">All months</option>
      </select>
    </label>
  );
}
