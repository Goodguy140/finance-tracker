import { CategorySpendPieChart, type CategorySpendSlice } from "@/components/category-spend-pie";
import { formatCurrency } from "@/lib/money";
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
  savingsSlice,
}: {
  periodDescription: string;
  categoryPieSlices: CategorySpendSlice[];
  chartHeight?: ChartHeight;
  maxSlices?: number;
  /** Net moved into savings, shown beside the categories when the card's setting is on. */
  savingsSlice?: CategorySpendSlice | null;
}) {
  return (
    <>
      <p className="mt-1 text-xs text-slate-400">
        {savingsSlice ? "Net spending by category and savings" : "Net spending by category"} · {periodDescription}
      </p>
      {savingsSlice ? (
        <p data-testid="savings-slice-note" className="mt-0.5 text-xs text-slate-500">
          Savings: {formatCurrency(savingsSlice.cents)} moved into savings accounts, net of what came back out.
        </p>
      ) : null}
      <CategorySpendPieChart
        data={savingsSlice ? [...categoryPieSlices, savingsSlice] : categoryPieSlices}
        height={PIE_HEIGHT_PX[chartHeight]}
        maxSlices={maxSlices}
      />
    </>
  );
}
