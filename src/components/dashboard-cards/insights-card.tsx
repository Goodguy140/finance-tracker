import Link from "next/link";
import { compareBySeverity } from "@/lib/insights/index";
import type { Insight, InsightSection } from "@/lib/insights/types";

const SECTION_LABELS: Record<InsightSection, string> = {
  ahead: "Coming up",
  gap: "Gaps",
  recurring: "Recurring",
  habit: "Habits",
  saving: "Savings",
  improvement: "Suggestions",
  good: "Going well",
};

const SEVERITY_DOT = { high: "bg-amber-400", medium: "bg-blue-400", low: "bg-slate-500" } as const;

export type InsightsCardBodyProps = {
  insights: Insight[];
  maxItems?: number;
};

/**
 * The dashboard's window onto /insights: how many of each kind are waiting, and the most
 * pressing few. Acting on them happens on the page, where there is room for the forms.
 */
export function InsightsCardBody({ insights, maxItems = 3 }: InsightsCardBodyProps) {
  if (insights.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Nothing needs your attention.{" "}
        <Link href="/insights" className="text-blue-300 underline underline-offset-4">
          Open insights
        </Link>
        {" · "}
        <Link href="/reports" className="text-blue-300 underline underline-offset-4">
          Reports
        </Link>
      </p>
    );
  }
  const counts = new Map<InsightSection, number>();
  for (const i of insights) counts.set(i.section, (counts.get(i.section) ?? 0) + 1);
  // Most pressing first across every section, unlike the page, which groups by section.
  const top = [...insights].sort(compareBySeverity).slice(0, maxItems);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SECTION_LABELS) as InsightSection[])
          .filter((s) => counts.has(s))
          .map((s) => (
            <span key={s} className="rounded-full border border-slate-700 bg-slate-950/50 px-2 py-0.5 text-xs text-slate-300">
              {SECTION_LABELS[s]} <span className="font-semibold text-slate-100">{counts.get(s)}</span>
            </span>
          ))}
      </div>
      <ul className="space-y-2">
        {top.map((insight) => (
          <li key={insight.key} className="flex gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[insight.severity]}`} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{insight.title}</p>
              <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">{insight.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link href="/insights" className="text-blue-300 underline underline-offset-4">
          {insights.length > top.length ? `See all ${insights.length} insights` : "Open insights"}
        </Link>
        {" · "}
        <Link href="/reports" className="text-blue-300 underline underline-offset-4">
          Reports
        </Link>
      </p>
    </div>
  );
}
