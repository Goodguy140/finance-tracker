import type { ReactNode } from "react";
import type { CardDensity } from "@/lib/dashboard-layout/schema";
import { categoryColor, NEUTRAL_CATEGORY_COLOR } from "@/lib/category-colors";
import { useCategoryColors } from "@/components/category-colors-context";

/**
 * Pieces shared by the Expense Log and Income lists: a date header per day, and compact
 * rows under it with a category dot, the title, one muted line of detail, and the amount.
 */

/** One dot per row; a split expense's dot is cut into its categories' colours. */
export function CategoryDot({ categoryIds }: { categoryIds: readonly string[] }) {
  const categoryColors = useCategoryColors();
  const colors = [...new Set(categoryIds)].map((id) => categoryColor(categoryColors, id));
  let background = colors[0] ?? NEUTRAL_CATEGORY_COLOR;
  if (colors.length > 1) {
    const step = 100 / colors.length;
    background = `conic-gradient(${colors
      .map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
      .join(", ")})`;
  }
  return (
    <span
      aria-hidden
      data-category-dot
      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-slate-950/60"
      style={{ background }}
    />
  );
}

export function TransactionDayHeader({
  dateDisplay,
  total,
}: {
  dateDisplay: string;
  /** The day's total, already formatted; omitted when there is none to show. */
  total?: string | null;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-slate-800/70 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:pt-0"
      data-testid="transaction-day-header"
    >
      <h3 className="min-w-0 truncate">{dateDisplay}</h3>
      {total ? <span className="shrink-0 tabular-nums normal-case tracking-normal">{total}</span> : null}
    </div>
  );
}

/** The day's rows. */
export function TransactionDay({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-slate-800/50">{children}</div>;
}

export function transactionRowClass(density: CardDensity | undefined, accent: "blue" | "emerald") {
  const pad = density === "compact" ? "py-1.5" : "py-2.5";
  const focus = accent === "emerald" ? "focus-visible:outline-emerald-500" : "focus-visible:outline-blue-500";
  return `flex w-full items-start gap-2.5 px-2 ${pad} text-left text-sm text-slate-100 transition hover:bg-slate-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 ${focus} touch-manipulation`;
}

/**
 * The muted line under the title, as running text so it wraps like a sentence. Expanded
 * rows allow two lines; compact rows hold it to one. What does not fit is left to the
 * tooltip and the edit dialog.
 */
export function TransactionMetaLine({
  children,
  title,
  density,
}: {
  children: ReactNode;
  title?: string;
  density: CardDensity | undefined;
}) {
  const clamp = density === "compact" ? "truncate" : "line-clamp-2";
  return (
    <span className={`mt-0.5 block min-w-0 ${clamp} text-xs leading-snug text-slate-400`} title={title}>
      {children}
    </span>
  );
}

/**
 * Joins detail fragments with a muted middle dot, skipping empty ones. The dot is held to
 * the fragment before it, so a wrapped line never starts with one.
 */
export function MetaParts({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <>
      {shown.map((part, i) => (
        <span key={i}>
          {part}
          {i < shown.length - 1 ? <span className="text-slate-600">{"\u00a0· "}</span> : null}
        </span>
      ))}
    </>
  );
}
