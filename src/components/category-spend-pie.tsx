"use client";

import type { TooltipProps } from "recharts";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/money";

export type CategorySpendSlice = {
  name: string;
  cents: number;
};

const SLICE_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#2dd4bf",
  "#818cf8",
  "#f472b6",
  "#4ade80",
  "#fcd34d",
];

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

export function CategorySpendPieChart({ data }: { data: CategorySpendSlice[] }) {
  const chartData = data
    .filter((d) => d.cents !== 0)
    .map((d) => ({
      name: d.name,
      cents: d.cents,
      /** Pie sector size; credits use absolute value so the chart stays readable. */
      value: Math.abs(d.cents),
    }));

  if (chartData.length === 0) {
    return <p className="text-sm text-slate-400">No category amounts in this period.</p>;
  }

  return (
    <div className="mt-2 w-full" style={{ minHeight: 280 }}>
      <ResponsiveContainer width="100%" height={280}>
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
            label={({ percent }: { percent?: number }) => {
              const p = percent ?? 0;
              return p >= 0.06 ? `${Math.round(p * 100)}%` : "";
            }}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={SLICE_COLORS[index % SLICE_COLORS.length]} stroke="#0f172a" strokeWidth={1} />
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
