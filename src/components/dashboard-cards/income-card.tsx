import { IncomeLogPanel, type IncomeLogEntry } from "@/components/income-log";
import type { CardDensity, ListHeight } from "@/lib/dashboard-layout/schema";
import { formatCurrency } from "@/lib/money";

type Option = { id: string; name: string };

export function IncomeCardBody({
  entries,
  accounts,
  categories,
  incomeSumCents,
  depositCount,
  density,
  maxHeight,
}: {
  entries: IncomeLogEntry[];
  accounts: Option[];
  categories: Option[];
  incomeSumCents: number;
  depositCount: number;
  density?: CardDensity;
  maxHeight?: ListHeight;
}) {
  return (
    <>
      {/*
        @sm rather than sm:, here and in every other card body: the card is sized by its
        column now, not by the viewport, so a viewport breakpoint would give a narrow card
        on a wide display the wide-card layout.
      */}
      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-800/80 pb-4 @sm:flex-row @sm:items-end @sm:justify-between @sm:gap-4">
        <p className="min-w-0 text-xs tabular-nums text-slate-500">
          {depositCount} deposit{depositCount === 1 ? "" : "s"}
        </p>
        <p className="shrink-0 text-2xl font-bold tabular-nums text-emerald-200 @sm:text-right">
          {formatCurrency(incomeSumCents)}
        </p>
      </div>
      <div className="pt-4">
        <IncomeLogPanel
          entries={entries}
          accounts={accounts}
          categories={categories}
          density={density}
          maxHeight={maxHeight}
        />
      </div>
    </>
  );
}
