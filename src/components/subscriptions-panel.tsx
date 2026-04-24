import { formatCurrency } from "@/lib/money";
import { MetaChip } from "@/components/meta-chip";

export type SubscriptionListItem = {
  id: string;
  name: string;
  amountCents: number;
  accountLabel: string;
  categoryLabel: string;
  billingCycleLabel: string;
  nextChargeDateDisplay: string;
};

export function SubscriptionsPanel({ items }: { items: SubscriptionListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No subscriptions yet. Add one from the{" "}
        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-xs font-medium text-slate-200">
          Add
        </span>{" "}
        menu.
      </p>
    );
  }

  return (
    <div className="max-h-[min(56vh,32rem)] space-y-2 overflow-y-auto pr-1">
      {items.map((sub) => (
        <div
          key={sub.id}
          className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-left text-sm text-slate-100"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-100">{sub.name}</span>
            <span className="shrink-0 rounded-full border border-blue-500/35 bg-blue-500/15 px-2.5 py-1 text-sm font-semibold tabular-nums text-blue-100">
              {formatCurrency(sub.amountCents)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetaChip label="Category">{sub.categoryLabel}</MetaChip>
            <MetaChip label="Account">{sub.accountLabel}</MetaChip>
            <MetaChip label="Billing">{sub.billingCycleLabel}</MetaChip>
            <MetaChip label="Next">{sub.nextChargeDateDisplay}</MetaChip>
          </div>
        </div>
      ))}
    </div>
  );
}
