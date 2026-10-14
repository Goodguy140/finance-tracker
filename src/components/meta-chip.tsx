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

const tagChipClass =
  "inline-flex max-w-full min-w-0 items-center rounded-full border border-teal-500/35 bg-teal-500/10 px-2.5 py-1 text-[11px] font-medium leading-tight text-teal-100 sm:text-xs";

/** A transaction's tags, one chip each. Renders nothing for an untagged transaction. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className={tagChipClass} title={`Tag: ${tag}`} data-testid="tag-chip">
          <span className="min-w-0 truncate">#{tag}</span>
        </span>
      ))}
    </>
  );
}

/**
 * A transaction's tags as bare `#tag` text, for the compact log rows, where a pill per tag
 * would bring back the chip clutter those rows replaced. Same test id as {@link TagChips}.
 */
export function InlineTags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <span key={tag}>
          {" "}
          <span className="font-medium text-teal-300/90" title={`Tag: ${tag}`} data-testid="tag-chip">
            #{tag}
          </span>
        </span>
      ))}
    </>
  );
}
