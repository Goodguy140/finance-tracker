import type { ReactNode } from "react";

export const metaChipClass =
  "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-slate-700/80 bg-slate-800/50 px-2.5 py-1 text-[11px] leading-tight text-slate-200 shadow-sm ring-1 ring-slate-950/40 sm:text-xs";

export function MetaChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={metaChipClass} title={typeof children === "string" ? `${label}: ${children}` : undefined}>
      <span className="shrink-0 font-medium text-slate-500">{label}</span>
      <span className="min-w-0 truncate font-medium text-slate-100">{children}</span>
    </span>
  );
}
