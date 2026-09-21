"use client";

import type { TooltipProps } from "recharts";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CumulativeSpendPoint } from "@/lib/cumulative-spend";
import { formatCurrency, fromCents } from "@/lib/money";

export type CumulativeSpendGranularity = "day" | "month";

/** Axis ticks stay short so a month of days still fits across a phone. */
function formatAxisAmount(cents: number): string {
  const units = fromCents(cents);
  if (Math.abs(units) >= 1_000) return `${Math.round(units / 100) / 10}k`;
  return String(Math.round(units));
}

function buildTooltip(granularity: CumulativeSpendGranularity) {
  return function CumulativeSpendTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as CumulativeSpendPoint | undefined;
    if (!row) return null;
    return (
      <div className="rounded-lg border border-slate-600 bg-slate-900/95 px-2.5 py-2 text-xs shadow-lg backdrop-blur">
        <p className="font-medium text-slate-100">{row.fullLabel}</p>
        <p className="tabular-nums text-slate-200">{formatCurrency(row.cumulativeCents)} total</p>
        {row.bucketCents !== 0 ? (
          <p className="tabular-nums text-slate-400">
            {row.bucketCents > 0 ? "+" : "−"}
            {formatCurrency(Math.abs(row.bucketCents))} this {granularity}
          </p>
        ) : null}
      </div>
    );
  };
}

export function CumulativeSpendChart({
  data,
  granularity,
}: {
  data: CumulativeSpendPoint[];
  granularity: CumulativeSpendGranularity;
}) {
  if (data.length === 0) {
    return <p className="mt-2 text-sm text-slate-400">No spending in this period yet.</p>;
  }

  return (
    <div className="mt-2 w-full" style={{ minHeight: 220 }}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={formatAxisAmount}
          />
          <Tooltip content={buildTooltip(granularity)} cursor={{ stroke: "#475569", strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="cumulativeCents"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
