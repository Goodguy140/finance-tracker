import {
  CumulativeSpendChart,
  type CumulativeSpendGranularity,
} from "@/components/cumulative-spend-chart";
import type { CumulativeSpendPoint } from "@/lib/cumulative-spend";
import { formatCurrency } from "@/lib/money";

export type CumulativeSpendCardProps = {
  periodDescription: string;
  points: CumulativeSpendPoint[];
  granularity: CumulativeSpendGranularity;
};

/** Running spend total across the selected period, shared by the desktop column and the mobile carousel. */
export function CumulativeSpendCard({ periodDescription, points, granularity }: CumulativeSpendCardProps) {
  const totalCents = points.length > 0 ? points[points.length - 1].cumulativeCents : 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Cumulative spending</h2>
          <p className="mt-1 text-xs text-slate-400">
            Running total by {granularity} · {periodDescription}
          </p>
        </div>
        <p className="shrink-0 text-xl font-bold tabular-nums text-sky-200">{formatCurrency(totalCents)}</p>
      </div>
      <CumulativeSpendChart data={points} granularity={granularity} />
    </div>
  );
}
