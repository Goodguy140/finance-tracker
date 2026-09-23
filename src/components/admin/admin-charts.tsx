"use client";

import type { TooltipProps } from "recharts";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Charts for the admin Analytics page. Counts over time only — nothing here plots money.
 *
 * Colours are the first slots of the reference categorical palette, stepped for a dark
 * surface and validated against slate-900 (#0f172a): lightness band, chroma, CVD and
 * normal-vision separation and 3:1 contrast all pass. Slot order is fixed so a series keeps
 * its colour whichever chart it appears in.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70"] as const;

export type ChartSeries = { key: string; label: string };

type Row = Record<string, string | number>;

function formatDayShort(day: string): string {
  const [, m, d] = day.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

function formatCount(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function buildTooltip(series: ChartSeries[]) {
  return function AdminSeriesTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as Row | undefined;
    if (!row) return null;
    return (
      <div className="rounded-lg border border-slate-600 bg-slate-900/95 px-2.5 py-2 text-xs shadow-lg backdrop-blur">
        <p className="font-medium text-slate-100">{formatDayShort(String(row.day))} (UTC)</p>
        {series.map((s, i) => (
          <p key={s.key} className="flex items-center gap-2 tabular-nums text-slate-200">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
            <span className="text-slate-400">{s.label}</span>
            <span className="ml-auto pl-3 font-medium">{Number(row[s.key] ?? 0).toLocaleString()}</span>
          </p>
        ))}
      </div>
    );
  };
}

/**
 * A daily line chart with a crosshair tooltip. One series needs no legend (the card title
 * names it); two or three get one, so identity never rests on colour alone. The same data
 * is always available as a table underneath.
 */
export function AdminTimeseriesChart({
  data,
  series,
  height = 200,
  tableCaption,
}: {
  data: Row[];
  series: ChartSeries[];
  height?: number;
  tableCaption: string;
}) {
  const allZero = data.every((row) => series.every((s) => Number(row[s.key] ?? 0) === 0));

  return (
    <div className="space-y-2">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative w-full" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDayShort}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#1e293b" }}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={formatCount}
            />
            <Tooltip content={buildTooltip(series)} cursor={{ stroke: "#475569", strokeDasharray: "3 3" }} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={SERIES_COLORS[i]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: SERIES_COLORS[i], stroke: "#0f172a", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {allZero ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Nothing recorded in this range
          </p>
        ) : null}
      </div>
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-left">
            <caption className="sr-only">{tableCaption}</caption>
            <thead className="sticky top-0 bg-slate-950 text-slate-400">
              <tr>
                <th className="px-2 py-1 font-medium">Day (UTC)</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => (
                <tr key={String(row.day)} className="border-t border-slate-800/80">
                  <td className="px-2 py-1 font-mono text-slate-300">{String(row.day)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right tabular-nums text-slate-200">
                      {Number(row[s.key] ?? 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A tiny trend line for a stat tile. Decorative: the tile's figure carries the meaning. */
export function Sparkline({ values, color = SERIES_COLORS[0] }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 24;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(h - 2 - (v / max) * (h - 4)).toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
