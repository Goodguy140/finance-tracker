import {
  CumulativeSpendChart,
  type CumulativeSpendGranularity,
} from "@/components/cumulative-spend-chart";
import {
  summarizeCumulativeSpend,
  type CumulativeSpendPoint,
  type ExpectedSpendBasis,
} from "@/lib/cumulative-spend";
import type { ChartHeight } from "@/lib/dashboard-layout/schema";
import { formatCurrency } from "@/lib/money";

export type CumulativeSpendCardProps = {
  periodDescription: string;
  points: CumulativeSpendPoint[];
  granularity: CumulativeSpendGranularity;
  expectedBasis: ExpectedSpendBasis | null;
  chartHeight?: ChartHeight;
  showExpectedLine?: boolean;
};

const EXPECTED_SOURCE_LABEL: Record<ExpectedSpendBasis, string> = {
  budgets: "your budgets",
  average: "your last 3 months",
};

export const CHART_HEIGHT_PX: Record<ChartHeight, number> = {
  compact: 150,
  default: 220,
  tall: 340,
};

/**
 * Running spend total across the selected period. Body only — the panel chrome and heading
 * belong to DashboardCard, so this renders the same whether it sits in a desktop column or
 * as a slide of the mobile carousel.
 */
export function CumulativeSpendCardBody({
  periodDescription,
  points,
  granularity,
  expectedBasis,
  chartHeight = "default",
  showExpectedLine = true,
}: CumulativeSpendCardProps) {
  const { totalCents, gapCents } = summarizeCumulativeSpend(points);
  const basis = showExpectedLine ? expectedBasis : null;

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-xs text-slate-400">
          Running total by {granularity} · {periodDescription}
        </p>
        <div className="min-w-0 @sm:text-right">
          <p className="truncate text-xl font-bold tabular-nums text-sky-200">{formatCurrency(totalCents)}</p>
          {gapCents !== null && basis !== null ? (
            <p className={`truncate text-xs tabular-nums ${gapCents > 0 ? "text-red-300" : "text-emerald-300"}`}>
              {formatCurrency(Math.abs(gapCents))} {gapCents > 0 ? "over" : "under"} expected
            </p>
          ) : null}
        </div>
      </div>
      <CumulativeSpendChart
        data={points}
        granularity={granularity}
        expectedBasis={basis}
        height={CHART_HEIGHT_PX[chartHeight]}
      />
      {basis && points.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-sky-400" aria-hidden />
            Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-indigo-400/70" aria-hidden />
            Expected pace from {EXPECTED_SOURCE_LABEL[basis]}
          </span>
        </div>
      ) : null}
    </>
  );
}
