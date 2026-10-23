"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The shell every dashboard card sits in. It owns the panel chrome that used to be retyped
 * at each call site, the heading, and the edit-mode affordances — so a card body only ever
 * renders its own content.
 *
 * `role="region"` with an accessible name gives every card a stable handle for assistive
 * technology and for the e2e suite, which previously had to climb two DOM parents from a
 * heading to find one.
 */
export type DashboardCardProps = {
  /** Stable id from the layout registry; also the drag identity and the e2e hook. */
  cardId: string;
  /** Accessible name for the region. For a stack this names every card it holds. */
  regionLabel: string;
  /** Usually the title text; a stack passes its tab strip here instead. */
  titleSlot: ReactNode;
  subtitle?: ReactNode;
  /** Card-specific header controls, e.g. Budgets' "Manage budgets" link. */
  headerActions?: ReactNode;
  /** The settings gear, when the card has anything to configure. */
  settingsControl?: ReactNode;
  /** The drag handle; only supplied in edit mode. */
  dragControl?: ReactNode;
  /** Takes the card (or a stack's tab on screen) off the dashboard; only supplied in edit mode. */
  removeControl?: ReactNode;
  /**
   * Covers the body while the layout is being edited, so a drag cannot land inside a live
   * form or a chart tooltip. Sits above the body and below the header, leaving the gear and
   * the handle usable.
   */
  editing?: boolean;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
};

export function DashboardCard({
  cardId,
  regionLabel,
  titleSlot,
  subtitle,
  headerActions,
  settingsControl,
  dragControl,
  removeControl,
  editing = false,
  style,
  className = "",
  children,
}: DashboardCardProps) {
  return (
    <section
      role="region"
      aria-label={regionLabel}
      id={`card-${cardId}`}
      data-card-id={cardId}
      style={style}
      // min-w-0 is load-bearing: a grid or flex child defaults to min-width:auto, which is
      // the usual reason a dashboard grows a horizontal scrollbar it cannot be rid of.
      className={`relative flex min-w-0 scroll-mt-20 flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4 ${className}`}
    >
      <header className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {typeof titleSlot === "string" ? (
            <h2 className="truncate text-lg font-semibold text-slate-100">{titleSlot}</h2>
          ) : (
            titleSlot
          )}
          {subtitle ? <div className="text-xs text-slate-400">{subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          {settingsControl}
          {dragControl}
          {removeControl}
        </div>
      </header>

      {/*
        The container query context for everything inside. Card width no longer tracks
        viewport width — a four-column layout on a wide display gives cards narrower than a
        phone — so card bodies size themselves against this box, not against the window.
      */}
      <div className="@container min-w-0">{children}</div>

      {editing ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 top-12 rounded-b-2xl bg-slate-950/20" aria-hidden />
      ) : null}
    </section>
  );
}

/** The grab handle shown on each card while the layout is being edited. */
export function DragHandle({
  label,
  attributes,
  listeners,
  handleRef,
}: {
  label: string;
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  /**
   * dnd-kit's activator ref. Named `handleRef` rather than `ref` on purpose: `ref` is a
   * reserved prop, and forwarding one through a component is read as a ref access during
   * render.
   */
  handleRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={handleRef}
      aria-label={label}
      title={label}
      className="touch-none cursor-grab rounded-lg border border-slate-700/80 bg-slate-900/90 p-1.5 text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
        <circle cx="5.5" cy="3" r="1.4" />
        <circle cx="10.5" cy="3" r="1.4" />
        <circle cx="5.5" cy="8" r="1.4" />
        <circle cx="10.5" cy="8" r="1.4" />
        <circle cx="5.5" cy="13" r="1.4" />
        <circle cx="10.5" cy="13" r="1.4" />
      </svg>
    </button>
  );
}

/** The control that takes a card off the dashboard while the layout is being edited. */
export function RemoveCardButton({
  title,
  disabled,
  onRemove,
}: {
  title: string;
  /** True for the last card on the dashboard, which has to stay so there is a way back. */
  disabled: boolean;
  onRemove: () => void;
}) {
  const label = `Remove ${title}`;
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      aria-label={label}
      title={disabled ? "The dashboard needs at least one card" : `${label} — add it back from Add card`}
      className="rounded-lg border border-slate-700/80 bg-slate-900/90 p-1.5 text-slate-300 transition hover:border-red-500/50 hover:bg-slate-800 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
