import {
  CumulativeSpendChart,
  type CumulativeSpendGranularity,
} from "@/components/cumulative-spend-chart";
import type { CumulativeSpendPoint, ExpectedSpendBasis } from "@/lib/cumulative-spend";
import { formatCurrency } from "@/lib/money";

export type CumulativeSpendCardProps = {
  periodDescription: string;
  points: CumulativeSpendPoint[];
  granularity: CumulativeSpendGranularity;
  expectedBasis: ExpectedSpendBasis | null;
};

const EXPECTED_SOURCE_LABEL: Record<ExpectedSpendBasis, string> = {
  budgets: "your budgets",
  average: "your last 3 months",
};

/** Running spend total across the selected period, shared by the desktop column and the mobile carousel. */
export function CumulativeSpendCard({
  periodDescription,
  points,
  granularity,
  expectedBasis,
}: CumulativeSpendCardProps) {
  const last = points.length > 0 ? points[points.length - 1] : null;
  const totalCents = last?.cumulativeCents ?? 0;
  const expectedCents = last?.expectedCents ?? null;
  const gapCents = expectedCents === null ? null : totalCents - expectedCents;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Cumulative spending</h2>
          <p className="mt-1 text-xs text-slate-400">
            Running total by {granularity} · {periodDescription}
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-xl font-bold tabular-nums text-sky-200">{formatCurrency(totalCents)}</p>
          {gapCents !== null ? (
            <p className={`text-xs tabular-nums ${gapCents > 0 ? "text-red-300" : "text-emerald-300"}`}>
              {formatCurrency(Math.abs(gapCents))} {gapCents > 0 ? "over" : "under"} expected
            </p>
          ) : null}
        </div>
      </div>
      <CumulativeSpendChart data={points} granularity={granularity} expectedBasis={expectedBasis} />
      {expectedBasis && points.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-sky-400" aria-hidden />
            Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm border border-indigo-400/40 bg-indigo-400/25"
              aria-hidden
            />
            Expected pace from {EXPECTED_SOURCE_LABEL[expectedBasis]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
