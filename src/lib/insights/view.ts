import { ymdFromDateUtc } from "@/lib/date-only";
import type { InsightItemView } from "@/components/insights/insight-item";
import type { LoadedInsights } from "./load";
import type { Insight } from "./types";

function toView(insight: Insight, loaded: LoadedInsights, dismissedUntil?: Date | null): InsightItemView {
  const evidence = insight.evidenceTxIds.flatMap((id) => {
    const tx = loaded.evidence.get(id);
    return tx
      ? [{ id, date: ymdFromDateUtc(tx.date), title: tx.title ?? "", amountCents: tx.amountCents, type: tx.type }]
      : [];
  });
  return {
    ...insight,
    evidence,
    ...(dismissedUntil !== undefined ? { dismissedUntil: dismissedUntil ? ymdFromDateUtc(dismissedUntil) : null } : {}),
  };
}

/** Flattens loaded insights into plain props for the client components. */
export function insightViews(loaded: LoadedInsights): { visible: InsightItemView[]; dismissed: InsightItemView[] } {
  return {
    visible: loaded.visible.map((i) => toView(i, loaded)),
    dismissed: loaded.dismissed.map((i) => toView(i, loaded, i.snoozedUntil)),
  };
}
