"use client";

import type { TooltipProps } from "recharts";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CumulativeSpendPoint, ExpectedSpendBasis } from "@/lib/cumulative-spend";
import { formatCurrency, fromCents } from "@/lib/money";

export type CumulativeSpendGranularity = "day" | "month";

/** Axis ticks stay short so a month of days still fits across a phone. */
function formatAxisAmount(cents: number): string {
  const units = fromCents(cents);
  if (Math.abs(units) >= 1_000) return `${Math.round(units / 100) / 10}k`;
  return String(Math.round(units));
}

function buildTooltip(granularity: CumulativeSpendGranularity, expectedLabel: string | null) {
  return function CumulativeSpendTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as CumulativeSpendPoint | undefined;
    if (!row) return null;
    const gapCents = row.expectedCents === null ? null : row.cumulativeCents - row.expectedCents;
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
        {row.expectedCents !== null && gapCents !== null ? (
          <p className="mt-1 border-t border-slate-700 pt-1 tabular-nums text-indigo-200">
            {formatCurrency(row.expectedCents)} expected
            {expectedLabel ? ` (${expectedLabel})` : ""}
            <span className={gapCents > 0 ? "text-red-300" : "text-emerald-300"}>
              {" · "}
              {formatCurrency(Math.abs(gapCents))} {gapCents > 0 ? "over" : "under"}
            </span>
          </p>
        ) : null}
      </div>
    );
  };
}

export function CumulativeSpendChart({
  data,
  granularity,
  expectedBasis,
}: {
  data: CumulativeSpendPoint[];
  granularity: CumulativeSpendGranularity;
  expectedBasis: ExpectedSpendBasis | null;
}) {
  if (data.length === 0) {
    return <p className="mt-2 text-sm text-slate-400">No spending in this period yet.</p>;
  }

  const hasExpected = expectedBasis !== null && data.some((p) => p.expectedCents !== null);
  const expectedLabel =
    expectedBasis === "budgets" ? "budgeted" : expectedBasis === "average" ? "3-month average" : null;

  return (
    <div className="mt-2 w-full" style={{ minHeight: 220 }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
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
          <Tooltip
            content={buildTooltip(granularity, expectedLabel)}
            cursor={{ fill: "#1e293b", fillOpacity: 0.4 }}
          />
          {/* Declared first so it paints behind the actual-spend line. */}
          {hasExpected ? (
            <Bar
              dataKey="expectedCents"
              fill="#818cf8"
              fillOpacity={0.22}
              stroke="#818cf8"
              strokeOpacity={0.35}
              strokeWidth={1}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="cumulativeCents"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#38bdf8", stroke: "#0f172a", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
