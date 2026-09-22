import { CategorySpendPieChart, type CategorySpendSlice } from "@/components/category-spend-pie";
import type { ChartHeight } from "@/lib/dashboard-layout/schema";

const PIE_HEIGHT_PX: Record<ChartHeight, number> = {
  compact: 200,
  default: 280,
  tall: 380,
};

export function SpendingByCategoryCardBody({
  periodDescription,
  categoryPieSlices,
  chartHeight = "default",
  maxSlices,
}: {
  periodDescription: string;
  categoryPieSlices: CategorySpendSlice[];
  chartHeight?: ChartHeight;
  maxSlices?: number;
}) {
  return (
    <>
      <p className="mt-1 text-xs text-slate-400">Net spending by category · {periodDescription}</p>
      <CategorySpendPieChart
        data={categoryPieSlices}
        height={PIE_HEIGHT_PX[chartHeight]}
        maxSlices={maxSlices}
      />
    </>
  );
}
