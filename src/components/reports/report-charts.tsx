"use client";

import type { TooltipProps } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashFlow, CashFlowNode, MerchantMonth, MonthFlow } from "@/lib/reports";
import { formatCurrency, fromCents } from "@/lib/money";

const INCOME_COLOR = "#34d399";
const SPENDING_COLOR = "#38bdf8";

const NODE_COLORS: Record<CashFlowNode["kind"], string> = {
  income: INCOME_COLOR,
  refunds: "#2dd4bf",
  shortfall: "#fbbf24",
  hub: "#94a3b8",
  expense: SPENDING_COLOR,
  savings: "#a78bfa",
  saved: "#c4b5fd",
};

const tooltipBox = "rounded-lg border border-slate-600 bg-slate-900/95 px-2.5 py-2 text-xs shadow-lg backdrop-blur";

/** Axis ticks stay short so twelve months still fit across a phone. */
function formatAxisAmount(cents: number): string {
  const units = fromCents(cents);
  if (Math.abs(units) >= 1_000) return `${Math.round(units / 100) / 10}k`;
  if (Math.abs(units) >= 100) return String(Math.round(units));
  return String(Math.round(units * 100) / 100);
}

const axisProps = {
  stroke: "#64748b",
  tick: { fill: "#94a3b8", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "#334155" },
} as const;

export function IncomeSpendingChart({ data, currency }: { data: MonthFlow[]; currency: string }) {
  function renderTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as MonthFlow;
    return (
      <div className={tooltipBox}>
        <p className="font-medium text-slate-100">{row.label}</p>
        <p className="tabular-nums text-slate-300">Income {formatCurrency(row.incomeCents, currency)}</p>
        <p className="tabular-nums text-slate-300">Spending {formatCurrency(row.spendingCents, currency)}</p>
        <p className={`mt-1 border-t border-slate-700 pt-1 tabular-nums ${row.netCents >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
          {row.netCents >= 0 ? (row.toSavingsCents === null ? "Saved" : "Left over") : "Overspent"}{" "}
          {formatCurrency(Math.abs(row.netCents), currency)}
        </p>
        {row.toSavingsCents !== null ? (
          <p className={`tabular-nums ${row.toSavingsCents >= 0 ? "text-violet-300" : "text-amber-300"}`}>
            {row.toSavingsCents >= 0 ? "To savings" : "From savings"} {formatCurrency(Math.abs(row.toSavingsCents), currency)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full" style={{ minHeight: 260 }}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barGap={2}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axisProps} tickFormatter={formatAxisAmount} width={48} />
          <Tooltip content={renderTooltip} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
          <Legend
            wrapperStyle={{ fontSize: "11px" }}
            formatter={(value) => <span className="text-slate-400">{value}</span>}
          />
          <Bar dataKey="incomeCents" name="Income" fill={INCOME_COLOR} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar dataKey="spendingCents" name="Spending" fill={SPENDING_COLOR} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={18} />
          {data.some((m) => m.toSavingsCents !== null) ? (
            <Bar dataKey="toSavingsCents" name="To savings" fill={NODE_COLORS.savings} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={18} />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type SankeyNodeProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: CashFlowNode;
};

type SankeyLinkProps = {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  payload: { source: CashFlowNode; target: CashFlowNode; value: number };
};

export function CashFlowSankey({ flow, currency }: { flow: CashFlow; currency: string }) {
  if (flow.nodes.length === 0) {
    return <p className="text-sm text-slate-400">No income or spending in this period.</p>;
  }
  const rows = Math.max(
    flow.nodes.filter((n) => n.kind === "expense" || n.kind === "savings" || n.kind === "saved").length,
    flow.nodes.filter((n) => n.kind === "income" || n.kind === "refunds" || n.kind === "shortfall").length,
  );
  const height = Math.max(240, rows * 48);

  function renderNode({ x, y, width, height: h, payload }: SankeyNodeProps) {
    const isSource = payload.kind === "income" || payload.kind === "refunds" || payload.kind === "shortfall";
    const isHub = payload.kind === "hub";
    // Sources are labelled to their right and sinks to their left, so labels stay inside the
    // chart at any width instead of needing a wide gutter that a phone does not have.
    const textX = isHub ? x + width / 2 : isSource ? x + width + 6 : x - 6;
    const anchor = isHub ? "middle" : isSource ? "start" : "end";
    const textY = isHub ? y - 14 : y + h / 2 - 6;
    return (
      <g>
        <rect x={x} y={y} width={width} height={Math.max(h, 1)} rx={2} fill={NODE_COLORS[payload.kind]} />
        <text
          x={textX}
          y={textY}
          textAnchor={anchor}
          dominantBaseline="middle"
          className="fill-slate-100 text-[11px] font-medium"
          stroke="#0f172a"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {payload.name}
        </text>
        <text
          x={textX}
          y={textY + 13}
          textAnchor={anchor}
          dominantBaseline="middle"
          className="fill-slate-400 text-[11px] tabular-nums"
          stroke="#0f172a"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {formatCurrency(payload.cents, currency)}
        </text>
      </g>
    );
  }

  function renderLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }: SankeyLinkProps) {
    const end = payload.target.kind === "hub" ? payload.source : payload.target;
    return (
      <path
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={NODE_COLORS[end.kind]}
        strokeOpacity={0.3}
        strokeWidth={Math.max(linkWidth, 1)}
      />
    );
  }

  function renderTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const item = payload[0]?.payload?.payload as
      | { source?: CashFlowNode; target?: CashFlowNode; value?: number; name?: string; cents?: number }
      | undefined;
    if (!item) return null;
    const title = item.source && item.target ? `${item.source.name} → ${item.target.name}` : item.name;
    const cents = item.value ?? item.cents ?? 0;
    return (
      <div className={tooltipBox}>
        <p className="font-medium text-slate-100">{title}</p>
        <p className="tabular-nums text-slate-300">{formatCurrency(cents, currency)}</p>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ minHeight: height }} data-testid="cash-flow-sankey">
      <ResponsiveContainer width="100%" height={height}>
        <Sankey
          data={flow}
          dataKey="value"
          nodeWidth={10}
          nodePadding={30}
          margin={{ top: 28, right: 4, bottom: 8, left: 4 }}
          node={renderNode as never}
          link={renderLink as never}
          sort={false}
        >
          <Tooltip content={renderTooltip} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

export function MerchantMonthChart({ data, currency }: { data: MerchantMonth[]; currency: string }) {
  const hasIncome = data.some((m) => m.receivedCents !== 0);
  function renderTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as MerchantMonth;
    return (
      <div className={tooltipBox}>
        <p className="font-medium text-slate-100">{row.label}</p>
        <p className="tabular-nums text-slate-300">Spent {formatCurrency(row.spentCents, currency)}</p>
        {hasIncome ? (
          <p className="tabular-nums text-slate-300">Received {formatCurrency(row.receivedCents, currency)}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="w-full" style={{ minHeight: 200 }}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barGap={2}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axisProps} tickFormatter={formatAxisAmount} width={48} />
          <Tooltip content={renderTooltip} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
          {hasIncome ? (
            <Legend wrapperStyle={{ fontSize: "11px" }} formatter={(value) => <span className="text-slate-400">{value}</span>} />
          ) : null}
          <Bar dataKey="spentCents" name="Spent" fill={SPENDING_COLOR} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={24} />
          {hasIncome ? (
            <Bar dataKey="receivedCents" name="Received" fill={INCOME_COLOR} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={24} />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
