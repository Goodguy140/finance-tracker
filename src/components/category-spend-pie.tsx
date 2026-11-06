"use client";

import { useRouter } from "next/navigation";
import type { TooltipProps } from "recharts";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/money";
import { collapseToMaxSlices } from "@/lib/category-pie";

export type CategorySpendSlice = {
  name: string;
  cents: number;
  /** The category's colour from assignCategoryColors, so the slice matches its log dots. */
  color: string;
  /** Never rolled into "Other categories": the Savings slice, which is not a category. */
  pinned?: boolean;
  /** Where clicking the slice goes: the category's trend page. Absent for groups and Savings. */
  href?: string;
};

function renderTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { name: string; cents: number };
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900/95 px-2.5 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-medium text-slate-100">{row.name}</p>
      <p className="text-slate-300">{formatCurrency(row.cents)}</p>
    </div>
  );
}

export function CategorySpendPieChart({
  data,
  height = 280,
  maxSlices,
}: {
  data: CategorySpendSlice[];
  height?: number;
  /** Beyond this many slices the remainder is rolled into one "Other categories" wedge. */
  maxSlices?: number;
}) {
  const router = useRouter();
  const chartData = collapseToMaxSlices(data.filter((d) => d.cents !== 0), maxSlices).map((d) => ({
    name: d.name,
    cents: d.cents,
    color: d.color,
    href: "href" in d ? d.href : undefined,
    /** Pie sector size; credits use absolute value so the chart stays readable. */
    value: Math.abs(d.cents),
  }));

  if (chartData.length === 0) {
    return <p className="text-sm text-slate-400">No category amounts in this period.</p>;
  }

  return (
    <div className="mt-2 w-full" style={{ minHeight: height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={88}
            paddingAngle={1}
            onClick={(_, index) => {
              const href = chartData[index]?.href;
              if (href) router.push(href);
            }}
            label={({ percent }: { percent?: number }) => {
              const p = percent ?? 0;
              return p >= 0.06 ? `${Math.round(p * 100)}%` : "";
            }}
          >
            {chartData.map((slice, index) => (
              <Cell
                key={`cell-${index}`}
                fill={slice.color}
                stroke="#0f172a"
                strokeWidth={1}
                style={slice.href ? { cursor: "pointer" } : undefined}
              />
            ))}
          </Pie>
          <Tooltip content={renderTooltip} />
          <Legend
            wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
            formatter={(value) => <span className="text-slate-400">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
